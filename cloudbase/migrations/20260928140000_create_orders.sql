-- 订单表：爱心小厨房的订单主表
--
-- 设计要点：
--   1. items 用 jsonb 存菜品清单（菜品是「快照」语义：下单时的菜名/图标/辣度/数量
--      必须冻结，日后改菜单不能影响历史订单），所以不适合拆成子表。
--   2. order_by 存"点给谁"的昵称，owner_openid 存下单人的微信身份。
--   3. status 限定三个值，用 CHECK 约束在数据库层兜底。
--   4. 时间统一用 timestamptz，展示时再由前端格式化成"几分钟前"。

CREATE TABLE IF NOT EXISTS public.orders (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  items         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  remark        TEXT        NOT NULL DEFAULT '',
  order_by      TEXT        NOT NULL DEFAULT '宝贝',
  owner_openid  TEXT        NOT NULL DEFAULT '',
  status        TEXT        NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_status_check CHECK (status IN ('pending', 'cooking', 'done'))
);

-- 订单页按创建时间倒序拉取，这个索引是主查询路径
CREATE INDEX IF NOT EXISTS orders_created_at_idx
  ON public.orders (created_at DESC);

-- 下面三条是给「管理角色」用的：云函数走 service_role 身份访问，
-- service_role 具备 BYPASSRLS，会自动绕过行级策略，因此只需 GRANT 表级权限。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.orders_id_seq TO service_role;
