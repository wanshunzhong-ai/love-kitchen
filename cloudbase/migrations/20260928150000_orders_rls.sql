-- 订单表权限：小程序用微信身份直连 PostgreSQL
--
-- 背景：小程序端（@cloudbase/wx-cloud-client-sdk）以微信身份访问时会带上 JWT，
--       数据库按 JWT 解析出的角色判断权限，角色共三种：
--         anon          未登录（本项目的场景下不会用到）
--         authenticated 已登录用户 —— 小程序里的微信用户就落在这个角色
--         service_role  管理员，会自动绕过 RLS
--
-- 本项目订单是「两个人共享同一份」的语义，不做按人隔离，
-- 所以策略写成：谁能登录谁就能读写全表。这在小情侣自用的场景下正是想要的效果。
--
-- 注意：RLS 默认「拒绝一切」，不写策略就一条都读不到。下面四条必须齐全。

-- 第一层：表级 GRANT（能不能执行这类操作）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.orders_id_seq TO authenticated;

-- 第二层：行级 RLS 策略（能碰到哪些行）
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- 查：登录用户可看全部订单
DROP POLICY IF EXISTS orders_auth_select ON public.orders;
CREATE POLICY orders_auth_select ON public.orders
  FOR SELECT TO authenticated
  USING (true);

-- 增：登录用户可下单
DROP POLICY IF EXISTS orders_auth_insert ON public.orders;
CREATE POLICY orders_auth_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 改：登录用户可改订单（改菜、改备注、推进状态）
DROP POLICY IF EXISTS orders_auth_update ON public.orders;
CREATE POLICY orders_auth_update ON public.orders
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- 删：登录用户可删订单
DROP POLICY IF EXISTS orders_auth_delete ON public.orders;
CREATE POLICY orders_auth_delete ON public.orders
  FOR DELETE TO authenticated
  USING (true);
