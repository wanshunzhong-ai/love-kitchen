-- 订单驳回：掌勺人不做这一单时，必须留下理由
--
-- 设计要点：
--   1. 驳回是第 4 个状态（rejected），不是布尔位。
--      为什么不另开一张「驳回记录」表：驳回是订单自身当下的状态，
--      且同一单可能「驳回 → 改单重提 → 再驳回」，用一张表反而要维护历史与当前的关系。
--   2. reject_reason 只存「最近一次驳回的理由」，并只在 status = 'rejected' 时展示。
--      重新提交（updateOrder）时会被清空 —— 留着会让人以为这单又被驳回了。
--   3. 老行必须能通过 CHECK：DEFAULT '' 保证 NOT NULL 成立。
--
-- 权限说明：列级权限继承表级 GRANT（orders_rls.sql 里已给 authenticated 授过
--          SELECT, INSERT, UPDATE, DELETE ON public.orders），新增列无需再 GRANT。

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS reject_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMPTZ;

-- 放开 status 的 CHECK 约束，允许 rejected
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'cooking', 'done', 'rejected'));

-- 驳回后要按状态筛（订单页有「已驳回」筛选），给状态列一个索引
CREATE INDEX IF NOT EXISTS orders_status_idx
  ON public.orders (status);
