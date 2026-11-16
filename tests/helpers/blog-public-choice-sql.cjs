'use strict';
/* The SQL a blog fixture database needs after 20261102120000 so that it holds the publication
 * rules the app uses since 2026-11-16 (owner decisions 7 and 9: the public name and intro saved
 * on their own, attachments chosen on every publish path; 20261116120000). In production every
 * migration below is installed in this order; a browser fixture that publishes through the app
 * appends `after(<the last of these it already applied>)` to its own list.
 * TEST-ONLY auth stubs: the Markdown publication functions read auth.users/auth.sessions and
 * auth.jwt(); nothing here is Supabase or a credential. */
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const AUTH = `create table if not exists auth.users(id uuid primary key);
alter table auth.users add column if not exists is_anonymous boolean not null default false;
create table if not exists auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
grant execute on function auth.jwt() to authenticated,service_role;`;
const CHAIN = [
  ['20261102120000', null],
  ['20261105051632', 'supabase/migrations/20261105051632_life_post_markdown.sql'],
  ['auth', AUTH],
  ['20261105081055', 'supabase/migrations/20261105081055_life_post_markdown_publish.sql'],
  ['20261111120000', 'supabase/migrations/20261111120000_life_blog_withdraw_before_publication.sql'],
  ['20261112120000', 'supabase/migrations/20261112120000_life_blog_revision_continuity.sql'],
  ['20261116120000', 'supabase/migrations/20261116120000_life_blog_public_choice.sql'],
];
// One SQL text with every step after `last` (a migration timestamp of the chain), in order.
function after(last) {
  const index = CHAIN.findIndex(([name]) => name === last);
  if (index < 0) throw Error('Unknown step of the public choice chain: ' + last);
  return CHAIN.slice(index + 1).map(([name, source]) => name === 'auth' ? source : fs.readFileSync(path.join(ROOT, source), 'utf8')).join('\n');
}
module.exports = { after, AUTH, FILE: 'supabase/migrations/20261116120000_life_blog_public_choice.sql' };
