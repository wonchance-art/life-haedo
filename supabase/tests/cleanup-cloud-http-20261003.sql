-- Local admin follow-up: only the two Cloud HTTP runs, expected 8 rows.
-- Exact generated IDs plus generated run-title prefixes; receipts cascade.
begin;
delete from public.life_workspaces
where (id in (
  '1e1db2c2-8751-4851-969c-112077d6d9bd'::uuid,
  '5c59c344-b85a-4742-9c1e-da7031573562'::uuid,
  '6ad0c3e8-92c5-40c0-bd85-69a5e8e9abb7'::uuid,
  '41fd61ff-d537-4113-ab2d-99ee6902decb'::uuid,
  '1ed1d315-8718-4ddb-9f0c-49335c3b9fc3'::uuid,
  'ecbb6904-d513-4817-8e57-06c43814555e'::uuid
) and title like '익명 동기화 검사 b3150a2d-e226-4478-a4a9-0e5d99577a3f%')
or (id in (
  '5bc1c7e1-1c79-41b2-b7da-8490865813d7'::uuid,
  'b6023805-5113-4eb1-a4ec-10ac8567417f'::uuid,
  'ac720940-4a3e-409a-a3d4-dda9213a321a'::uuid,
  '27b38200-0709-4f28-8737-39e2c33a4dd6'::uuid,
  '64279ace-bd4e-46ef-8689-5d3ce1ccb466'::uuid,
  '8bb8aade-06cc-4da6-b40c-6eab556d9941'::uuid
) and title like '익명 동기화 검사 00b814cb-a1a7-419d-aaa6-a6ecf357865e%')
returning id;
commit;
