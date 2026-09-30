-- 忌口清单：下单时把干饭人的忌口一起送到掌勺人手上
--
-- 设计要点：
--   1. avoids 是**随订单冻结的快照**（jsonb 字符串数组），语义与 items 一致。
--      掌勺人的手机读不到干饭人的本地存储，忌口只有跟着订单上云对方才看得见；
--      而且「这一顿是按当时那份忌口做的」这件事，事后不该被改动倒推 ——
--      干饭人后来添了新忌口，历史订单应当保持原样。
--   2. 只存收敛后的干净数组（去空白 / 去重 / 单条限长 / 条数限量），
--      规则定义在 utils/avoids.js，服务端收的时候再校一遍，脏数据进不了库。
--   3. NOT NULL DEFAULT '[]' 让老订单自动获得「没有忌口」，
--      前端无需判空：空数组 = 什么都不渲染。
--
-- 权限说明：列级权限继承表级 GRANT（orders_rls.sql / orders_anon_grant.sql 里已给
--          anon 与 authenticated 授过 SELECT, INSERT, UPDATE, DELETE ON public.orders），
--          新增列无需再 GRANT。

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS avoids JSONB NOT NULL DEFAULT '[]'::jsonb;
