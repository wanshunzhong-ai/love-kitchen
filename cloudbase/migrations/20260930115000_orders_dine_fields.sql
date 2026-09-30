-- 补齐：用餐时间两列（dine_date / dine_slot）
--
-- 为什么单独补这一份：
--   这两列早就随「用餐时间」功能上线并写进真库了，但当时的 ALTER 只跑在库上、
--   没有留下迁移文件。结果是「全新环境按 migrations/ 从零部署」会缺这两列，
--   创建订单时直接报列不存在 —— 迁移目录不完整是个真隐患，这里补记录。
--
-- 幂等：两列都用 IF NOT EXISTS，对已有的真库重复执行不会改动任何数据。

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dine_date DATE,
  ADD COLUMN IF NOT EXISTS dine_slot TEXT;
