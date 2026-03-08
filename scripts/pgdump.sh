export MAIN_DB_URL='postgresql://postgres:ecrMSqVmxn4WjsIv@db.zexoequftnmncyzpdkzk.supabase.co:5432/postgres?sslmode=require'
pg_dump "$MAIN_DB_URL" \
--format=plain \
--no-owner \
--no-privileges \
--file main_dump.sql