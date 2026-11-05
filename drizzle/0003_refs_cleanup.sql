-- Наведение порядка в справочниках (решение заказчика от 05.11.2026).
-- Безопасно для пустой базы: всё, чего нет, просто не меняется.

-- 1. Направления: все варианты «ПП…» («ПП - Поля», «ПП-осн», «ПП осн», «ПП-ДопАКТ») объединяются в «ПП»
INSERT INTO "directions" ("name", "key") VALUES ('ПП', 'пп') ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "activity_logs" ("action", "entity_type", "entity_id", "summary", "changes")
SELECT 'merge', 'direction', d."id"::text, 'Направление «' || d."name" || '» объединено с «ПП»',
  jsonb_build_object('Направление', jsonb_build_array(d."name", 'ПП'),
    'Перенесено заказов', jsonb_build_array(NULL, (SELECT count(*) FROM "purchase_orders" o WHERE o."direction_id" = d."id")),
    'Перенесено позиций', jsonb_build_array(NULL, (SELECT count(*) FROM "purchase_order_items" i WHERE i."direction_id" = d."id")))
FROM "directions" d WHERE d."key" <> 'пп' AND (d."key" LIKE 'пп-%' OR d."key" LIKE 'пп %');--> statement-breakpoint
UPDATE "purchase_orders" SET "direction_id" = (SELECT "id" FROM "directions" WHERE "key" = 'пп')
WHERE "direction_id" IN (SELECT "id" FROM "directions" WHERE "key" <> 'пп' AND ("key" LIKE 'пп-%' OR "key" LIKE 'пп %'));--> statement-breakpoint
UPDATE "purchase_order_items" SET "direction_id" = (SELECT "id" FROM "directions" WHERE "key" = 'пп')
WHERE "direction_id" IN (SELECT "id" FROM "directions" WHERE "key" <> 'пп' AND ("key" LIKE 'пп-%' OR "key" LIKE 'пп %'));--> statement-breakpoint
DELETE FROM "directions" WHERE "key" <> 'пп' AND ("key" LIKE 'пп-%' OR "key" LIKE 'пп %');--> statement-breakpoint

-- 2. Справочник направлений: ЗДР, ПП, Лаки, Фитотрейд (новые при импорте не создаются)
INSERT INTO "directions" ("name", "key") VALUES ('ЗДР', 'здр'), ('Лаки', 'лаки'), ('Фитотрейд', 'фитотрейд') ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- 3. Заказы поставщика «Юля-(ЛАКИ)» переходят на направление «Лаки»
INSERT INTO "activity_logs" ("action", "entity_type", "entity_id", "summary", "changes")
SELECT 'update', 'order', o."id"::text, 'Заказ №' || o."number" || ': направление → «Лаки»',
  jsonb_build_object('Направление', jsonb_build_array(d."name", 'Лаки'))
FROM "purchase_orders" o JOIN "suppliers" s ON s."id" = o."supplier_id" LEFT JOIN "directions" d ON d."id" = o."direction_id"
WHERE s."key" = 'юля-(лаки)' AND d."key" IS DISTINCT FROM 'лаки';--> statement-breakpoint
UPDATE "purchase_order_items" SET "direction_id" = (SELECT "id" FROM "directions" WHERE "key" = 'лаки')
WHERE "order_id" IN (SELECT o."id" FROM "purchase_orders" o JOIN "suppliers" s ON s."id" = o."supplier_id" WHERE s."key" = 'юля-(лаки)');--> statement-breakpoint
UPDATE "purchase_orders" SET "direction_id" = (SELECT "id" FROM "directions" WHERE "key" = 'лаки')
WHERE "supplier_id" IN (SELECT "id" FROM "suppliers" WHERE "key" = 'юля-(лаки)');--> statement-breakpoint

-- 4. «Фитотрейд» — направление, а не юрлицо (в листе «ПРИБОРЫ» стоял в колонке юрлица).
--    У строк плана поставок поля направления нет: юрлицо снимаем, направление пишем в примечание.
INSERT INTO "activity_logs" ("action", "entity_type", "entity_id", "summary", "changes")
SELECT 'delete', 'legal', l."id"::text, 'Юрлицо «Фитотрейд» удалено: это направление',
  jsonb_build_object('Юрлицо', jsonb_build_array(l."name", NULL),
    'Строк плана без юрлица', jsonb_build_array(NULL, (SELECT count(*) FROM "supply_plan_entries" WHERE "legal_entity_id" = l."id")))
FROM "legal_entities" l WHERE l."key" = 'фитотрейд'
  AND NOT EXISTS (SELECT 1 FROM "purchase_orders" WHERE "legal_entity_id" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "payments" WHERE "legal_entity_id" = l."id");--> statement-breakpoint
UPDATE "supply_plan_entries" SET "legal_entity_id" = NULL,
  "note" = CASE WHEN "note" IS NULL OR "note" = '' THEN 'направление Фитотрейд' ELSE "note" || '; направление Фитотрейд' END
WHERE "legal_entity_id" IN (SELECT l."id" FROM "legal_entities" l WHERE l."key" = 'фитотрейд'
  AND NOT EXISTS (SELECT 1 FROM "purchase_orders" WHERE "legal_entity_id" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "payments" WHERE "legal_entity_id" = l."id"));--> statement-breakpoint
DELETE FROM "legal_entities" l WHERE l."key" = 'фитотрейд'
  AND NOT EXISTS (SELECT 1 FROM "purchase_orders" WHERE "legal_entity_id" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "payments" WHERE "legal_entity_id" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "supply_plan_entries" WHERE "legal_entity_id" = l."id");--> statement-breakpoint

-- 5. Дубль «Добрынин» → «ИП Добрынин Дмитрий Андреевич»
UPDATE "purchase_orders" SET "legal_entity_id" = (SELECT "id" FROM "legal_entities" WHERE "key" = 'ип добрынин дмитрий андреевич')
WHERE "legal_entity_id" IN (SELECT "id" FROM "legal_entities" WHERE "key" = 'добрынин') AND EXISTS (SELECT 1 FROM "legal_entities" WHERE "key" = 'ип добрынин дмитрий андреевич');--> statement-breakpoint
UPDATE "payments" SET "legal_entity_id" = (SELECT "id" FROM "legal_entities" WHERE "key" = 'ип добрынин дмитрий андреевич')
WHERE "legal_entity_id" IN (SELECT "id" FROM "legal_entities" WHERE "key" = 'добрынин') AND EXISTS (SELECT 1 FROM "legal_entities" WHERE "key" = 'ип добрынин дмитрий андреевич');--> statement-breakpoint
UPDATE "supply_plan_entries" SET "legal_entity_id" = (SELECT "id" FROM "legal_entities" WHERE "key" = 'ип добрынин дмитрий андреевич')
WHERE "legal_entity_id" IN (SELECT "id" FROM "legal_entities" WHERE "key" = 'добрынин') AND EXISTS (SELECT 1 FROM "legal_entities" WHERE "key" = 'ип добрынин дмитрий андреевич');--> statement-breakpoint
DELETE FROM "legal_entities" WHERE "key" = 'добрынин' AND EXISTS (SELECT 1 FROM "legal_entities" WHERE "key" = 'ип добрынин дмитрий андреевич');--> statement-breakpoint

-- 6. Короткие названия для ИП: «ИП Добрынин Дмитрий Андреевич» → «Добрынин»
UPDATE "legal_entities" SET "short_name" = split_part("name", ' ', 2) WHERE "short_name" IS NULL AND "name" ~* '^ИП\s+\S+';
