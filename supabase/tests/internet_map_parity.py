# ABOUTME: Compare Python URL/privacy transforms and pipeline intermediates with local SQL rollups.
# ABOUTME: Keep real inputs and mismatches in private scratch and emit aggregate counts only.
import argparse
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict


def local_connection(dsn):
    options = conninfo_to_dict(dsn)
    if (options.get('host') not in ('127.0.0.1', 'localhost', '::1')
        or options.get('port') != '54322' or 'service' in options
        or options.get('hostaddr', options['host']) not in ('127.0.0.1', 'localhost', '::1')):
        raise ValueError('Parity requires the local Supabase endpoint on port 54322')
    # Override inherited PGHOSTADDR/PGSERVICE routing as well as the URL hostname.
    address = '::1' if options['host'] == '::1' else '127.0.0.1'
    return psycopg.connect(dsn, hostaddr=address, port=54322, connect_timeout=3)


def run_stage(python, scripts, name, *args, env=None):
    result = subprocess.run([python, scripts / name, *map(str, args)], capture_output=True,
                            env={**os.environ, **(env or {})})
    if result.returncode:
        raise RuntimeError(f'{name} failed; private output withheld')


def prepare(args):
    from copy_text import decode
    from urlnorm import normalise
    raw = args.scratch / 'raw'
    raw.mkdir()
    samples, events = [], []
    with (args.raw / 'collection_events.tsv').open(encoding='utf-8') as stream:
        for index, line in enumerate(stream):
            fields = line.rstrip('\n').split('\t')
            if len(fields) != 10 or fields[1] != 'navigation':
                raise ValueError('Unexpected raw event format')
            if index < args.events:
                events.append((fields[2], fields[0], line))
            if index % args.stride == 0:
                data = json.loads(decode(fields[9]))
                value = data.get('url') or decode(fields[5])
                samples.append({'url': value, 'title': ''})
            if len(samples) >= args.urls and index >= args.events:
                break
    # Stable timestamp/id order defines first-seen page ids and equal-time order.
    events.sort(key=lambda row: (datetime.datetime.fromisoformat(row[0]), row[1]))
    (raw / 'collection_events.tsv').write_text(''.join(row[2] for row in events))
    metadata = []
    with (args.raw / 'page_metadata_history.tsv').open(encoding='utf-8') as stream:
        for index, line in enumerate(stream):
            if index >= args.metadata:
                break
            fields = line.rstrip('\n').split('\t')
            if len(fields) != 9:
                raise ValueError('Unexpected raw metadata format')
            metadata.append((fields[6], fields[0], line))
            samples.append({'url': decode(fields[2]), 'title': ' '.join((decode(fields[3]) or '').split())})
    metadata.sort(key=lambda row: (datetime.datetime.fromisoformat(row[0]), row[1]))
    (raw / 'page_metadata_history.tsv').write_text(''.join(row[2] for row in metadata))
    (args.scratch / 'url-sample.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in samples))
    golden = args.scratch / 'reference'
    golden.mkdir()
    run_stage(sys.executable, args.fork / 'scripts', '02_nodes.py', raw / 'collection_events.tsv', golden)
    run_stage(sys.executable, args.fork / 'scripts', '03_titles.py', raw / 'page_metadata_history.tsv', golden)
    visits = (golden / 'visits.tsv').read_text().splitlines()
    # Match LC_ALL=C sort's last-resort full-line comparison for equal session/ms keys.
    visits.sort(key=lambda line: (int(line.split('\t')[0]), int(line.split('\t')[1]), line))
    (golden / 'visits_sorted.tsv').write_text('\n'.join(visits) + '\n')
    for stage, values in [('04_edges.py', [golden / 'visits_sorted.tsv', golden]),
                          ('06_covisit.py', [golden]), ('07_paths.py', [golden])]:
        run_stage(sys.executable, args.fork / 'scripts', stage, *values)
    # Check every sampled page identity against the existing full-bake node inventory.
    wanted = {line.split('\t')[1] for line in (golden / 'nodes.tsv').read_text().splitlines()}
    matched = 0
    with (args.full_intermediates / 'nodes.tsv').open(encoding='utf-8') as stream:
        for line in stream:
            if line.rstrip('\n').split('\t')[1] in wanted:
                matched += 1
    return samples, {'url_samples': len(samples), 'event_rows': len(events), 'metadata_rows': len(metadata),
                     'reference_pages': len(wanted), 'full_bake_page_keys_matched': matched}


def url_parity(connection, samples, scratch):
    import urlnorm
    import redact
    counts, matches, differences = collections.Counter(), collections.Counter(), []
    names = ('normalise', 'host', 'domain', 'redact_url', 'redact_url_keep_queries', 'redact_title', 'redact_host', 'redact_text')
    query = '''select n.page_key,n.host,internet_map.domain_of(n.host),
        internet_map.redact_url(n.page_key),internet_map.redact_url(n.page_key,true),
        internet_map.redact_title(v.title,n.page_key),internet_map.redact_host(n.host),internet_map.redact_text(v.title)
        from jsonb_to_recordset(%s::jsonb) as v(url text,title text)
        cross join lateral internet_map.normalise(v.url) n'''
    for start in range(0, len(samples), 1000):
        batch = samples[start:start+1000]
        rows = connection.execute(query, (json.dumps(batch),)).fetchall()
        for source, actual in zip(batch, rows):
            key, host = urlnorm.normalise(source['url'])
            expected = (key, host, urlnorm.domain_of(host), redact.redact_url(key), redact.redact_url(key, True),
                        redact.redact_title(source['title'], key), redact.redact_host(host), redact.redact_text(source['title']))
            for name, a, b in zip(names, actual, expected):
                counts[name] += 1
                matches[name] += a == b
                if a != b and len(differences) < 100:
                    differences.append({'field': name, 'source': source, 'sql': a, 'python': b})
    (scratch / 'url-mismatches.json').write_text(json.dumps(differences, ensure_ascii=False))
    return {name: {'matched': matches[name], 'total': counts[name], 'rate': matches[name] / counts[name]} for name in names}


def aggregate_intermediate_parity(args):
    reference = args.scratch / 'reference'
    aggregate = args.scratch / 'membership-reference'
    aggregate.mkdir(exist_ok=True)
    for name in ('nodes.tsv', 'node_stats.tsv', 'edges.tsv', 'titles.tsv', 'favicons.json', '_meta.json'):
        shutil.copyfile(reference / name, aggregate / name)
    sessions, participants, triples = set(), set(), collections.Counter()
    prior = []
    with (reference / 'visits_sorted.tsv').open() as stream:
        for line in stream:
            session, ms, page, participant = map(int, line.split())
            sessions.add((session, page)); participants.add((participant, page))
            if prior and prior[-1][0] == session and prior[-1][2] == page:
                continue
            if len(prior) == 2:
                a, b = prior
                if a[0] == b[0] == session and b[1] - a[1] <= 1800000 and ms - b[1] <= 1800000 and len({a[2], b[2], page}) == 3:
                    triples[min(a[2], page), b[2], max(a[2], page)] += 1
            prior = (prior + [(session, ms, page)])[-2:]
    for name, rows in [('page_sessions.tsv', sessions), ('page_participants.tsv', participants)]:
        (aggregate / name).write_text(''.join(f'{group}\t{page}\n' for group, page in sorted(rows)))
    (aggregate / 'triples.tsv').write_text(''.join(f'{a}\t{b}\t{c}\t{count}\n' for (a,b,c),count in sorted(triples.items())))
    for stage in ('06_covisit.py', '07_paths.py'):
        run_stage(sys.executable, args.fork / 'scripts', stage, aggregate, env={'ROLLUP_INPUT': '1'})
    files = compare_files(reference, aggregate)
    return {name: result for name, result in files.items() if name.startswith(('covisit_', 'paths', 'junctions'))}


def canonical_reference(args):
    reference = args.scratch / 'reference'
    canonical = args.scratch / 'canonical-reference'
    canonical.mkdir(exist_ok=True)
    for name in ('nodes.tsv', 'titles.tsv', 'favicons.json', '_meta.json'):
        shutil.copyfile(reference / name, canonical / name)
    # Stable sort retains the timestamp/id source order for equal milliseconds.
    visits = (reference / 'visits.tsv').read_text().splitlines()
    visits.sort(key=lambda line: tuple(map(int, line.split('\t')[:2])))
    (canonical / 'visits_sorted.tsv').write_text('\n'.join(visits) + '\n')
    for stage, values in [('04_edges.py', [canonical / 'visits_sorted.tsv', canonical]),
                          ('06_covisit.py', [canonical]), ('07_paths.py', [canonical])]:
        run_stage(sys.executable, args.fork / 'scripts', stage, *values)
    return canonical


def copy_sample(connection, raw, *, boundary=None, before=True):
    # Older exports can contain several open histories for one page. Close earlier
    # open versions for the current-row constraint; rollups never read valid_to_ts.
    open_versions = collections.defaultdict(list)
    for line in (raw / 'page_metadata_history.tsv').read_bytes().splitlines():
        values = line.split(b'\t')
        if values[7] == b'\\N':
            open_versions[values[1]].append(values)
    closed_at = {}
    for versions in open_versions.values():
        versions.sort(key=lambda row: (datetime.datetime.fromisoformat(row[6].decode()), row[0]))
        for previous, following in zip(versions, versions[1:]):
            closed_at[previous[0]] = following[6]
    (raw.parent / 'sample-adaptations.json').write_text(json.dumps({'closed_duplicate_current_metadata': len(closed_at)}))
    for table, fields, filename in (
        ('collection_events', 'id,type,ts,participant_id,session_id,url,viewport_width,viewport_height,timezone,data', 'collection_events.tsv'),
        ('page_metadata_history', 'id,page_ref,canonical_url,title,favicon_url,metadata_hash,valid_from_ts,valid_to_ts,created_at,latest_observed_at_ts', 'page_metadata_history.tsv'),
    ):
        with connection.cursor().copy(f'copy public.{table} ({fields}) from stdin') as copy:
            with (raw / filename).open('rb') as stream:
                if boundary is not None or table == 'page_metadata_history':
                    for line in stream:
                        values = line.rstrip(b'\n').split(b'\t')
                        timestamp = datetime.datetime.fromisoformat(values[6 if table == 'page_metadata_history' else 2].decode())
                        if boundary is not None and (timestamp < boundary) != before:
                            continue
                        if table == 'page_metadata_history':
                            values[7] = closed_at.get(values[0], values[7])
                            copy.write(b'\t'.join(values + [values[6]]) + b'\n')
                        else:
                            copy.write(line)
                else:
                    while block := stream.read(1024 * 1024):
                        copy.write(block)


def compare_files(reference, actual):
    results = {}
    # SQL surrogate ids have gaps; the loader emits contiguous ids in first-seen order.
    for name in ('nodes.tsv', 'node_stats.tsv', 'edges.tsv', 'titles.tsv', 'paths.tsv', 'paths_dom.tsv',
                 'junctions.tsv', 'covisit_dom.tsv', 'covisit_sub.tsv', 'covisit_page.tsv'):
        expected = collections.Counter((reference / name).read_text().splitlines())
        observed = collections.Counter((actual / name).read_text().splitlines())
        matched = sum((expected & observed).values())
        total = max(sum(expected.values()), sum(observed.values()))
        results[name] = {'matched': matched, 'total': total, 'rate': matched / total if total else 1.0}
    for name in ('_meta.json', 'favicons.json'):
        expected = json.loads((reference / name).read_text())
        observed = json.loads((actual / name).read_text())
        total = len(expected.keys() | observed.keys())
        matched = sum(key in observed and value == observed[key] for key, value in expected.items())
        results[name] = {'matched': matched, 'total': total, 'rate': matched / total if total else 1.0}
    return results


def rollup_parity(connection, args):
    from load_rollups import load
    if connection.execute('''select exists(select from public.collection_events)
        or exists(select from public.page_metadata_history) or exists(select from internet_map.pages)''').fetchone()[0]:
        raise ValueError('Rollup parity requires a fresh local db:reset')
    raw = args.scratch / 'raw'
    progress = {'chunks': 0, 'resumes': 0}
    if args.incremental:
        events = [line.split('\t') for line in (raw / 'collection_events.tsv').read_text().splitlines()]
        boundary = datetime.datetime.fromisoformat(events[len(events) // 2][2])
        earlier = [row for row in events if datetime.datetime.fromisoformat(row[2]) < boundary]
        later = [row for row in events if datetime.datetime.fromisoformat(row[2]) >= boundary]
        shared = {row[4] for row in earlier} & {row[4] for row in later}
        last_times = {row[4]: datetime.datetime.fromisoformat(row[2]) for row in earlier}
        first_times = {row[4]: datetime.datetime.fromisoformat(row[2]) for row in reversed(later)}
        active = sum((first_times[key] - last_times[key]).total_seconds() <= 1800 for key in shared)
        assert active, 'Sample must continue sessions across the incremental boundary'
        copy_sample(connection, raw, boundary=boundary)
        while True:
            result = connection.execute("select internet_map.rollup(%s, interval '1 day')", (boundary,)).fetchone()[0]
            connection.commit()
            progress['chunks'] += 1
            if progress['chunks'] == 3 and not result['caught_up']:
                connection.close()
                connection = local_connection(os.environ.get('LOCAL_DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'))
                progress['resumes'] += 1
            if result['caught_up']:
                break
        progress.update(first_events=len(earlier), incremental_events=len(later), continuing_sessions=len(shared), continuing_sessions_within_gap=active, backfill_chunks=progress['chunks'])
        # End the connection to prove the checkpoint survives a process boundary.
        connection.close()
        connection = local_connection(os.environ.get('LOCAL_DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'))
        progress['resumes'] += 1
        copy_sample(connection, raw, boundary=boundary, before=False)
    else:
        copy_sample(connection, raw)
    cutoff = connection.execute('''select greatest((select max(ts) from public.collection_events),
        (select max(valid_from_ts) from public.page_metadata_history)) + interval '1 millisecond' ''').fetchone()[0]
    while True:
        result = connection.execute('select internet_map.rollup(%s, interval \'1 day\')', (cutoff,)).fetchone()[0]
        connection.commit()
        progress['chunks'] += 1
        if result['caught_up']:
            break
    connection.execute(sql.SQL('grant internet_map_reader to {}').format(sql.Identifier(connection.info.user)))
    connection.commit()
    connection.execute('set role internet_map_reader')
    connection.commit()
    aggregate = args.scratch / ('incremental-aggregate' if args.incremental else 'aggregate')
    # Historic fixture snapshots intentionally predate freshness limits.
    load(connection, aggregate, max_age_hours=1e9)
    connection.execute('reset role')
    connection.commit()
    for stage in ('06_covisit.py', '07_paths.py'):
        run_stage(sys.executable, args.fork / 'scripts', stage, aggregate, env={'ROLLUP_INPUT': '1'})
    (args.scratch / 'rollup-progress.json').write_text(json.dumps(progress, indent=2))
    connection.close()
    return compare_files(canonical_reference(args), aggregate), compare_files(args.scratch / 'reference', aggregate)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fork', type=Path, required=True)
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--full-intermediates', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--urls', type=int, default=100000)
    parser.add_argument('--stride', type=int, default=137)
    parser.add_argument('--events', type=int, default=100000)
    parser.add_argument('--metadata', type=int, default=25000)
    parser.add_argument('--reuse', action='store_true')
    parser.add_argument('--incremental', action='store_true')
    args = parser.parse_args()
    args.scratch = args.scratch.resolve()
    roots = (Path(__file__).resolve().parents[2], args.fork.resolve())
    if any(args.scratch == root or root in args.scratch.parents for root in roots):
        raise ValueError('Scratch must be outside both repositories')
    if min(args.urls, args.stride, args.events, args.metadata) <= 0:
        raise ValueError('Sample sizes must be positive')
    os.umask(0o077)
    args.scratch.mkdir(parents=True, exist_ok=args.reuse, mode=0o700)
    sys.path.insert(0, str(args.fork / 'scripts'))
    report_path = args.scratch / 'parity-report.json'
    if args.reuse:
        samples = [json.loads(line) for line in (args.scratch / 'url-sample.jsonl').read_text().splitlines()]
        report = json.loads(report_path.read_text())
    else:
        samples, report = prepare(args)
        report_path.write_text(json.dumps(report, indent=2))
    report['sql_status'] = 'RUNNING'
    report['membership_file_parity'] = aggregate_intermediate_parity(args)
    report_path.write_text(json.dumps(report, indent=2))
    try:
        connection = local_connection(os.environ.get('LOCAL_DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'))
    except psycopg.OperationalError:
        report['sql_status'] = 'BLOCKED: local Supabase unavailable; SQL parity not measured'
        report_path.write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
        return 2
    try:
        report['url_parity'] = url_parity(connection, samples, args.scratch)
        report_path.write_text(json.dumps(report, indent=2))
        connection.commit()
        report['rollup_parity'], report['legacy_order_parity'] = rollup_parity(connection, args)
    finally:
        connection.close()
    report['sql_status'] = 'PASS' if all(v['rate'] == 1 for group in ('url_parity', 'rollup_parity') for v in report[group].values()) else 'FAIL'
    report_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0 if report['sql_status'] == 'PASS' else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'Parity failed ({type(error).__name__}); private exception details withheld.', file=sys.stderr)
        sys.exit(1)
