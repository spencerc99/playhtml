-- ABOUTME: Create the dedicated aggregate-only login after explicit operator approval.
-- ABOUTME: Grant no raw-table access, writes, routine execution, or inherited roles.
create role internet_map_reader login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant connect on database postgres to internet_map_reader;
grant usage on schema internet_map to internet_map_reader;
grant select on all tables in schema internet_map to internet_map_reader;
alter default privileges for role postgres in schema internet_map grant select on tables to internet_map_reader;
alter role internet_map_reader set default_transaction_read_only = on;
alter role internet_map_reader set statement_timeout = '15min';
-- Set the password with psql's \password internet_map_reader, never in committed SQL.
