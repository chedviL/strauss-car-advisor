-- supabase/migrations/0011_vehicle_commercial_name.sql
-- מוסיף כינוי מסחרי לרכב בטבלת ה-dataset, כדי שזיהוי רכב-בשם (למשל ATTO 3)
-- יישען על אותה רשומה מזוהה - ולא על ניחוש של המודל שהחליף רכבים (CAR-03 Dolphin
-- מול CAR-10 ATTO 3, שניהם יצרן 01014). חד-פעמי: עמודה + backfill מהקטלוג הסטטי.
alter table vehicles add column if not exists commercial_name text;

-- backfill לפי קוד קטלוג (הקטלוג סטטי; הקוד->שם קבוע).
update vehicles set commercial_name = 'PICANTO'          where catalog_code = 'CAR-01' and commercial_name is null;
update vehicles set commercial_name = 'YARIS CROSS HSD'  where catalog_code = 'CAR-02' and commercial_name is null;
update vehicles set commercial_name = 'BYD DOLPHIN'      where catalog_code = 'CAR-03' and commercial_name is null;
update vehicles set commercial_name = 'LEON'             where catalog_code = 'CAR-04' and commercial_name is null;
update vehicles set commercial_name = 'NIRO'             where catalog_code = 'CAR-05' and commercial_name is null;
update vehicles set commercial_name = 'MG4'              where catalog_code = 'CAR-06' and commercial_name is null;
update vehicles set commercial_name = 'COROLLA'          where catalog_code = 'CAR-07' and commercial_name is null;
update vehicles set commercial_name = 'KONA EV'          where catalog_code = 'CAR-08' and commercial_name is null;
update vehicles set commercial_name = 'COROLLA CROSS'    where catalog_code = 'CAR-09' and commercial_name is null;
update vehicles set commercial_name = 'ATTO 3'           where catalog_code = 'CAR-10' and commercial_name is null;
update vehicles set commercial_name = 'EV3'              where catalog_code = 'CAR-11' and commercial_name is null;
update vehicles set commercial_name = 'TUCSON'           where catalog_code = 'CAR-12' and commercial_name is null;
update vehicles set commercial_name = 'MAZDA 3'          where catalog_code = 'CAR-13' and commercial_name is null;
update vehicles set commercial_name = 'MODEL 3'          where catalog_code = 'CAR-14' and commercial_name is null;
update vehicles set commercial_name = 'OCTAVIA'          where catalog_code = 'CAR-15' and commercial_name is null;
update vehicles set commercial_name = 'SPORTAGE HEV'     where catalog_code = 'CAR-16' and commercial_name is null;
update vehicles set commercial_name = 'SEAL'             where catalog_code = 'CAR-17' and commercial_name is null;
update vehicles set commercial_name = 'RAV4'             where catalog_code = 'CAR-18' and commercial_name is null;
update vehicles set commercial_name = 'CARNIVAL'         where catalog_code = 'CAR-19' and commercial_name is null;
update vehicles set commercial_name = 'SANTA FE'         where catalog_code = 'CAR-20' and commercial_name is null;