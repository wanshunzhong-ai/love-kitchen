-- 订单评价：干饭人对「已上菜」订单里的每一道菜单独打分
--
-- 设计要点：
--   1. reviews 用 jsonb，键 = 菜品行标识（dishId|辣度，与前端 itemKey 一致），
--      值 = { rating, tags[], text, by, at }。
--      为什么不拆子表：评价与订单是 1:1 的附属数据，且「一道菜一条」的粒度和
--      items 里的行一一对应；拆表反而要维护外键与行对齐，收益为零。
--   2. NOT NULL DEFAULT '{}' 让老订单自动获得空评价，前端无需判空。
--   3. 默认空对象而不是空数组：评价是「按行查找」的语义，对象键查找 O(1)，
--      也天然保证「同一道菜只有一条评价」不会被写重复。
--
-- 权限说明：列级权限继承表级 GRANT（migrations 里已给 anon / authenticated 授过
--          SELECT, INSERT, UPDATE, DELETE ON public.orders），新增列无需再 GRANT。

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS reviews JSONB NOT NULL DEFAULT '{}'::jsonb;
