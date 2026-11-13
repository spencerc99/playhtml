-- Commute desk decisions (human ground truth) joined to one page Clef saw for each, with Clef's call.
WITH p AS (SELECT scope, place_key, placement, reason FROM place_policies WHERE placement IS NOT NULL),
s AS (
  SELECT p.*, (SELECT l.id FROM place_clef_log l WHERE l.kind='page' AND (
    (p.scope='page' AND l.page_key = p.place_key) OR
    (p.scope='path' AND l.page_key LIKE '%' || p.place_key || '%') OR
    (p.scope IN ('site','hostname') AND (l.page_key LIKE 'https://' || p.place_key || '%' OR l.page_key LIKE 'https://www.' || p.place_key || '%' OR l.page_key LIKE 'http://' || p.place_key || '%' OR l.page_key LIKE 'https://%.' || p.place_key || '/%'))
  ) ORDER BY l.id DESC LIMIT 1) AS log_id FROM p)
SELECT s.scope, s.place_key, s.placement AS human, s.reason, l.page_key, l.input_json,
  json_extract(l.suggestion_json, '$.placement') AS clef
FROM s JOIN place_clef_log l ON l.id = s.log_id;
