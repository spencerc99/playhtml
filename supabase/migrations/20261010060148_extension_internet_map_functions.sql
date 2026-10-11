-- ABOUTME: Normalize browsing URLs and redact published labels using the bake's rules.
-- ABOUTME: Keep URL identity and privacy transforms inside the private internet_map schema.
create schema internet_map;
revoke all on schema internet_map from public, anon, authenticated, service_role;

create function internet_map.mask(n integer) returns text
language sql immutable strict set search_path = pg_catalog
as $$ select repeat('█', least(greatest(n, 1), 24)) $$;

-- PostgreSQL text cannot contain NUL; normalization removes it in either implementation.
create function internet_map.unquote(value text, plus boolean default false) returns text
language plpgsql immutable strict set search_path = pg_catalog as $$
declare
  bytes bytea := ''::bytea; result text := ''; i integer := 1; c integer;
  size integer; valid integer; lower_byte integer; upper_byte integer;
begin
  if plus then value := replace(value, '+', ' '); end if;
  while i <= length(value) loop
    if substr(value, i, 3) ~ '^%[0-9a-fA-F]{2}$' then
      bytes := bytes || decode(substr(value, i + 1, 2), 'hex'); i := i + 3;
    else
      bytes := bytes || convert_to(substr(value, i, 1), 'UTF8'); i := i + 1;
    end if;
  end loop;
  i := 0;
  while i < octet_length(bytes) loop
    c := get_byte(bytes, i);
    if c < 128 then
      if c > 0 then result := result || chr(c); end if;
      i := i + 1; continue;
    end if;
    size := case when c between 194 and 223 then 2 when c between 224 and 239 then 3
                 when c between 240 and 244 then 4 else 0 end;
    if size = 0 then result := result || '�'; i := i + 1; continue; end if;
    valid := 1;
    for j in 1..size - 1 loop
      exit when i + j >= octet_length(bytes);
      lower_byte := 128; upper_byte := 191;
      if j = 1 then
        if c = 224 then lower_byte := 160; elsif c = 237 then upper_byte := 159;
        elsif c = 240 then lower_byte := 144; elsif c = 244 then upper_byte := 143; end if;
      end if;
      exit when get_byte(bytes, i + j) not between lower_byte and upper_byte;
      valid := valid + 1;
    end loop;
    if valid = size then result := result || convert_from(substring(bytes from i + 1 for size), 'UTF8');
    else result := result || '�'; end if;
    i := i + valid;
  end loop;
  return result;
end $$;

create function internet_map.domain_of(host text) returns text
language plpgsql immutable strict set search_path = pg_catalog as $$
declare bare text := split_part(host, ':', 1); labels text[]; n integer;
begin
  if bare = '' or bare = 'localhost' or replace(bare, '.', '') ~ '^[[:digit:]]+$' then return bare; end if;
  labels := string_to_array(bare, '.'); n := cardinality(labels);
  if n <= 2 then return bare; end if;
  if array_to_string(labels[n-1:n], '.') = any(array['ac.cn','ac.id','ac.il','ac.in','ac.jp','ac.nz','ac.th','ac.uk','ac.za','asn.au','co.id','co.il','co.in','co.jp','co.ke','co.kr','co.nz','co.th','co.tz','co.ug','co.uk','co.za','com.ar','com.au','com.bd','com.bh','com.bo','com.br','com.cn','com.co','com.de','com.ec','com.eg','com.es','com.gh','com.gr','com.hk','com.it','com.jo','com.kw','com.lb','com.mx','com.my','com.ng','com.np','com.om','com.pe','com.ph','com.pk','com.pl','com.pt','com.py','com.qa','com.ru','com.sa','com.se','com.sg','com.tr','com.tw','com.ua','com.uy','com.ve','com.vn','edu.au','edu.br','edu.cn','firm.in','gen.in','go.id','go.jp','go.kr','go.th','gov.au','gov.br','gov.cn','gov.il','gov.in','gov.uk','gov.za','govt.nz','id.au','in.th','ind.in','lg.jp','ltd.uk','me.uk','ne.jp','ne.kr','net.au','net.br','net.cn','net.il','net.in','net.nz','net.pl','net.ru','net.uk','net.za','or.id','or.jp','or.kr','org.au','org.br','org.cn','org.il','org.in','org.nz','org.pl','org.ru','org.uk','org.za','pe.kr','plc.uk','re.kr','sch.uk','school.nz','web.id']::text[]) then
    return array_to_string(labels[n-2:n], '.');
  end if;
  return array_to_string(labels[n-1:n], '.');
end $$;

create function internet_map.normalise(value text) returns table(page_key text, host text)
language plpgsql immutable set search_path = pg_catalog as $$
declare
  rest text; path text; query text; pair text; k text; v text; sp text;
  pairs jsonb := '[]'::jsonb; q text := ''; search_page boolean; pos integer; address text;
begin
  page_key := ''; host := '';
  if value is null then return next; return; end if;
  rest := regexp_replace(value, '^[\x01-\x20]+', '');
  rest := translate(rest, E'\t\r\n', '');
  rest := regexp_replace(rest, '^[a-zA-Z][a-zA-Z0-9+.-]*:', '');
  if left(rest, 2) <> '//' then return next; return; end if;
  rest := substr(rest, 3);
  host := substring(rest from '^[^/?#]*');
  rest := substr(rest, length(host) + 1);
  host := lower(host collate "und-x-icu");
  host := regexp_replace(host, '^.*@', '');
  if left(host, 4) = 'www.' then host := substr(host, 5); end if;
  if host = '' or (position('[' in host) > 0) <> (position(']' in host) > 0) then
    host := ''; return next; return;
  end if;
  if normalize(translate(host, '/?#@:', ''), NFKC) ~ '[/\?#@:]' then
    host := ''; return next; return;
  end if;
  if strpos(host, '[') > 0 then
    address := substring(host from '\[([^]]*)\]');
    if left(address, 1) = 'v' then
      if address !~ '^v[0-9a-f]+\..+$' then host := ''; return next; return; end if;
    else
      begin
        if family(split_part(address, '%', 1)::inet) <> 6 then host := ''; return next; return; end if;
      exception when invalid_text_representation then host := ''; return next; return;
      end;
    end if;
  end if;
  rest := split_part(rest, '#', 1);
  pos := position('?' in rest);
  if pos > 0 then path := left(rest, pos - 1); query := substr(rest, pos + 1);
  else path := rest; query := ''; end if;
  path := regexp_replace(coalesce(nullif(path, ''), '/'), '/+', '/', 'g');
  if length(path) > 1 then path := regexp_replace(path, '/$', ''); end if;
  path := internet_map.unquote(path);
  sp := ('{"google.com": "q", "google.co.uk": "q", "google.ca": "q", "google.com.au": "q", "google.de": "q", "google.fr": "q", "google.co.in": "q", "google.com.br": "q", "google.co.jp": "q", "google.it": "q", "google.es": "q", "google.nl": "q", "duckduckgo.com": "q", "bing.com": "q", "search.yahoo.com": "p", "ecosia.org": "q", "search.brave.com": "q", "startpage.com": "query", "kagi.com": "q", "baidu.com": "wd", "yandex.com": "text", "mojeek.com": "q", "searx.be": "q", "lite.duckduckgo.com": "q", "youtube.com": "search_query", "m.youtube.com": "search_query", "reddit.com": "q", "old.reddit.com": "q", "github.com": "q", "stackoverflow.com": "q", "amazon.com": "k", "amazon.co.uk": "k", "amazon.ca": "k", "amazon.de": "k", "x.com": "q", "twitter.com": "q", "pinterest.com": "q", "etsy.com": "q", "ebay.com": "_nkw", "en.wikipedia.org": "search", "wikipedia.org": "search", "scholar.google.com": "q", "news.google.com": "q", "images.google.com": "q", "perplexity.ai": "q", "www.perplexity.ai": "q", "spotify.com": "q", "open.spotify.com": "q", "soundcloud.com": "q", "vimeo.com": "q", "tiktok.com": "q", "linkedin.com": "keywords", "instagram.com": "q", "tumblr.com": "q", "are.na": "q", "arxiv.org": "query", "semanticscholar.org": "q", "goodreads.com": "q"}'::jsonb)->>host;
  search_page := sp is not null and (path = '/' or lower(path collate "und-x-icu") ~ '^(/search|/results|/s|/find|/explore/search|/web|/wiki/special:search|/sp/search|/discover/search)');
  foreach pair in array string_to_array(query, '&') loop
    pos := position('=' in pair);
    if pos = 0 then continue; end if;
    k := internet_map.unquote(left(pair, pos - 1), true);
    v := internet_map.unquote(substr(pair, pos + 1), true);
    if v = '' then continue; end if;
    if search_page then
      if k = sp and v collate "und-x-icu" ~ '[^[:space:]]' then
        q := '?' || sp || '=' || lower(left(btrim(regexp_replace(v collate "und-x-icu", '[[:space:]]+', ' ', 'g')), 120) collate "und-x-icu"); exit;
      end if;
    elsif not (k = any(array['__cft__[0]','__tn__','_ga','_gl','_nc_hash','ab_channel','app','aqs','at_campaign','at_medium','authuser','bih','biw','cad','campaign_id','cd','chainedPosts','checksum','cid','client','cmpid','comment_tracking','context','correlationId','csui','cvid','dclid','dpr','ei','eid','enter_from','esrc','fbclid','feature','form','from_page','fromsearch','fs','gbv','gclid','ghpvc','ghsrc','gid','gl','gs_lcrp','gs_lp','gs_ssp','guccounter','guce_referrer','guce_referrer_sig','hl','icid','ie','iflsig','igshid','index','is_from_webapp','language','licu','lipi','list_index','log_pb','mc_cid','mc_eid','mibextid','midSig','midToken','msclkid','ncid','nfpr','notif_id','notif_t','oe','oq','originTrackingId','otpToken','pc','pjf','pp','prmd','pws','rct','rdt','ref','refId','ref_src','ref_url','referer','referrer','rlz','s_kwcid','sa','safe','sca_esv','sclient','scm','screen_name','sei','sender_device','sessionId','session_id','share_id','share_source','shareid','showsuggestions','si','soc_src','soc_trk','source','sourceid','spm','src','sstk','start_radio','sxsrf','t','tab','taid','tbo','trackingId','trk','twclid','uact','udm','usg','usp','utm_brand','utm_campaign','utm_cid','utm_content','utm_id','utm_medium','utm_name','utm_reader','utm_referrer','utm_social','utm_source','utm_term','uule','ved','web_id','yclid']::text[])) and left(k, 4) <> 'utm_' and left(k, 4) <> '__cf' and length(v) <= 80 then
      pairs := pairs || jsonb_build_array(jsonb_build_array(k, v));
    end if;
  end loop;
  if not coalesce(search_page, false) then
    select coalesce('?' || string_agg((p->>0) || '=' || (p->>1), '&'), '') into q
    from (select p from jsonb_array_elements(pairs) p order by (p->>0) collate "C", (p->>1) collate "C" limit 6) sorted;
  end if;
  page_key := left(regexp_replace(host || path || q, '[\x01-\x1f\x7f]', '', 'g'), 300);
  return next;
end $$;

create function internet_map.opaque(seg text) returns boolean
language plpgsql immutable strict set search_path = pg_catalog as $$
declare part text collate "und-x-icu"; cleaned text collate "und-x-icu"; letters text collate "und-x-icu";
begin
  if length(seg) >= 10 and seg collate "und-x-icu" ~ '^[[:digit:]]+$' then return true; end if;
  foreach part in array regexp_split_to_array(seg, '[-_.~+]') loop
    cleaned := regexp_replace(part, '[^[:alnum:]]', '', 'g');
    if (length(cleaned) >= 10 and cleaned ~ '^[[:digit:]]+$') or
       (length(cleaned) >= 16 and cleaned ~ '^[0-9a-fA-F]+$') then return true; end if;
  end loop;
  if seg collate "und-x-icu" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or seg collate "und-x-icu" ~* '^[0-9a-f]{8,}$' then return true; end if;
  if length(seg) < 14 then return false; end if;
  if (seg collate "und-x-icu" ~ '[[:digit:]]' and seg collate "und-x-icu" ~ '[[:alpha:]]') or
     (substr(seg, 2) collate "und-x-icu" ~ '[[:upper:]].*[[:upper:]]' and seg collate "und-x-icu" ~ '[[:lower:]]' and seg collate "und-x-icu" !~ '[-_]') then return true; end if;
  letters := regexp_replace(lower(seg collate "und-x-icu"), '[^[:alpha:]]', '', 'g');
  return length(letters) > 0 and length(regexp_replace(letters, '[^aeiou]', '', 'g'))::float / length(letters) < 0.28;
end $$;

create function internet_map.private_host(host text) returns boolean
language sql immutable strict set search_path = pg_catalog as $$
 select host ~* '^(localhost|127\.\d|10\.\d|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|0\.0\.0\.0)|\.(local|internal|lan|home|test|localdomain)(:|$)'
$$;

create function internet_map.host_matches(host text, domains text[]) returns boolean
language sql immutable strict set search_path = pg_catalog as $$
 select exists(select from unnest(domains) d where lower(host) = d or right(lower(host), length(d) + 1) = '.' || d)
$$;

create function internet_map.mask_matches(value text, pattern text) returns text
language plpgsql immutable strict set search_path = pg_catalog as $$
declare result text := ''; matched text; pos integer;
begin
  loop
    matched := substring(value from pattern);
    exit when matched is null or matched = '';
    pos := strpos(value, matched);
    result := result || left(value, pos - 1) || internet_map.mask(length(matched));
    value := substr(value, pos + length(matched));
  end loop;
  return result || value;
end $$;

create function internet_map.redact_segment(seg text) returns text
language plpgsql immutable strict set search_path = pg_catalog as $$
declare suffix text;
begin
  if internet_map.opaque(seg) then return internet_map.mask(length(seg)); end if;
  suffix := substring(seg from '(?i)[-_][0-9a-f]{16,}$');
  if suffix is not null then return left(seg, length(seg) - length(suffix)) || internet_map.mask(length(suffix) - 1); end if;
  return seg;
end $$;

create function internet_map.redact_query(query text, keep_all boolean) returns text
language plpgsql immutable strict set search_path = pg_catalog as $$
declare pair text; k text; v text; pos integer; result text[] := '{}'::text[];
begin
  foreach pair in array string_to_array(query, '&') loop
    pos := strpos(pair, '=');
    k := case when pos = 0 then pair else left(pair, pos - 1) end;
    v := case when pos = 0 then '' else substr(pair, pos + 1) end;
    if internet_map.opaque(k) then
      k := internet_map.mask(length(k));
      if v <> '' then v := internet_map.mask(length(v)); end if;
    elsif v <> '' and (not (keep_all or lower(k) = any(array['category','keyword','kw','lang','list','page','q','query','search','search_query','sort','start','t','tab','tag','tags','title','v']::text[])) or internet_map.opaque(v)
          or pair ~* '(otpauth:|[?&](secret|token|auth|key|password|pwd)=)' or v ~ '[\w.+-]+@[\w-]+\.[\w.]{2,}') then
      v := internet_map.mask(length(v));
    end if;
    result := array_append(result, k || case when v = '' then '' else '=' || v end);
  end loop;
  return array_to_string(result, '&');
end $$;

create function internet_map.redact_url(value text, keep_queries boolean default false) returns text
language plpgsql immutable strict set search_path = pg_catalog as $$
declare host text := split_part(value, '/', 1); rest text; path text; query text; cut integer;
  labels text[]; label text; segments text[]; result text; first_seg text; tail text;
begin
  if value = '' then return value; end if;
  if internet_map.private_host(host) then return 'private-network'; end if;
  rest := substr(value, length(host) + 1);
  cut := least(coalesce(nullif(strpos(rest, '?'), 0), length(rest)+1),
               coalesce(nullif(strpos(rest, '#'), 0), length(rest)+1),
               coalesce(nullif(strpos(rest, '&'), 0), length(rest)+1));
  path := left(rest, cut-1); query := substr(rest, cut);
  labels := '{}';
  foreach label in array string_to_array(host, '.') loop
    labels := array_append(labels, case when internet_map.opaque(label) then internet_map.mask(length(label)) else label end);
  end loop;
  host := array_to_string(labels, '.');
  if internet_map.host_matches(host, array['bit.ly','calendly.com','chat.whatsapp.com','discord.gg','forms.gle','goo.gl','meet.google.com','notion.site','notion.so','t.me','tinyurl.com','us02web.zoom.us','www.notion.so','zoom.us']::text[]) then
    return host || case when btrim(path, '/') = '' then '' else '/' || internet_map.mask(length(btrim(path, '/'))) end;
  end if;
  if internet_map.host_matches(host, array['app.pandadoc.com','app.slack.com','box.com','calendar.google.com','discord.com','discord.gg','discordapp.com','docusign.net','dropbox.com','groups.google.com','keep.google.com','mail.google.com','mail.yahoo.com','meet.google.com','messenger.com','outlook.live.com','outlook.office.com','powerforms.docusign.net','teams.microsoft.com','web.telegram.org','web.whatsapp.com','zoom.us']::text[]) then
    first_seg := split_part(ltrim(path, '/'), '/', 1);
    tail := substring(path from '^/[^/]*/(.*)$');
    return host || case when first_seg = '' then '' else '/' || internet_map.redact_segment(first_seg) end ||
      case when coalesce(tail, '') = '' then '' else '/' || internet_map.mask(length(tail)) end;
  end if;
  segments := '{}';
  foreach label in array string_to_array(path, '/') loop
    segments := array_append(segments, case when internet_map.host_matches(host, array['docs.google.com','drive.google.com','sheets.google.com','slides.google.com']::text[]) then label else internet_map.redact_segment(label) end);
  end loop;
  result := host || array_to_string(segments, '/');
  if query <> '' then result := result || '?' || internet_map.redact_query(substr(query, 2), keep_queries); end if;
  result := internet_map.mask_matches(result, '[\w.+-]+@[\w-]+\.[\w.]{2,}');
  return internet_map.mask_matches(result, '\meyJ[\w-]{8,}\.[\w-]+\.[\w-]+');
end $$;

create function internet_map.redact_text(value text) returns text
language plpgsql immutable strict set search_path = pg_catalog as $$
declare result text := ''; matched text; pos integer; scheme text;
begin
  if value ~* '(otpauth:|[?&](secret|token|auth|key|password|pwd)=)' then return ''; end if;
  loop
    matched := substring(value from '\m(?:https?://|otpauth://)\S+');
    exit when matched is null;
    pos := strpos(value, matched); scheme := split_part(matched, '://', 1);
    result := result || left(value, pos-1) || scheme || '://' || internet_map.redact_url(substr(matched, length(scheme)+4));
    value := substr(value, pos+length(matched));
  end loop;
  return result || value;
end $$;

create function internet_map.redact_title(title text, url text) returns text
language plpgsql immutable strict set search_path = pg_catalog as $$
declare host text := lower(split_part(url, '/', 1)); result text;
begin
  if internet_map.private_host(host) or internet_map.host_matches(host, array['app.pandadoc.com','app.slack.com','bit.ly','box.com','calendar.google.com','calendly.com','chat.whatsapp.com','discord.com','discord.gg','discordapp.com','docusign.net','dropbox.com','forms.gle','goo.gl','groups.google.com','keep.google.com','mail.google.com','mail.yahoo.com','meet.google.com','messenger.com','notion.site','notion.so','outlook.live.com','outlook.office.com','powerforms.docusign.net','t.me','teams.microsoft.com','tinyurl.com','us02web.zoom.us','web.telegram.org','web.whatsapp.com','www.notion.so','zoom.us']::text[]) then return ''; end if;
  result := internet_map.redact_text(title);
  result := internet_map.mask_matches(result, '[\w.+-]+@[\w-]+\.[\w.]{2,}');
  result := internet_map.mask_matches(result, '(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
  result := internet_map.mask_matches(result, '(?i)\m[0-9a-f]{16,}\M');
  return left(internet_map.mask_matches(result, '\meyJ[\w-]{8,}\.[\w-]+\.[\w-]+'), 120);
end $$;

create function internet_map.redact_host(host text) returns text
language sql immutable strict set search_path = pg_catalog as $$
 select internet_map.redact_url(host)
$$;

create function internet_map.clean_title(title text) returns text
language plpgsql immutable strict set search_path = pg_catalog as $$
begin
  title := btrim(regexp_replace(title collate "und-x-icu", '[[:space:]]+', ' ', 'g'));
  while left(title, 1) = '(' and strpos(left(title, 8), ')') > 0 loop
    title := btrim(substr(title, strpos(title, ')') + 1));
  end loop;
  return left(title, 140);
end $$;

revoke all on all functions in schema internet_map from public, anon, authenticated, service_role;
alter default privileges in schema internet_map revoke execute on functions from public;
