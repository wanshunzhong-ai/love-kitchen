-- 修复：小程序直连 PG 时实际落到的角色是 anon，而非 authenticated
--
-- 问题现象：菜单（本地数据）正常，订单页能读（0 条也正常显示），但一下单就
--           「下单没成功」，且 orders 表里始终 0 条记录。
--
-- 根因（已通过读 SDK 源码确认）：
--   @cloudbase/wx-cloud-client-sdk 的 rdb() 并不直接发 HTTP 请求给 PostgREST，
--   而是把每个请求包装成 wx.cloud.callFunction 调用（云函数 methodName
--   "callWedaApi" / realMethodName "$runSQL"）由服务端代理转发。
--   这条链路上小程序端不会附带「已登录」的 JWT —— 数据库侧因此把请求解析成
--   anon 角色。而上一个迁移里只给 authenticated 授了写权限，
--   anon 仅有 SELECT → 读得到、写不进。
--
-- 修正思路：
--   本项目是两个人自用的私密小程序，订单语义就是「双方共享同一份」，
--   不存在按用户隔离的诉求；anon 在本场景等价于「打开这个小程序的人」，
--   因此直接给 anon 补齐写权限，与 authenticated 保持一致。
--
-- 安全说明：这样做的前提是「只有你俩能打开这个小程序」。若日后要对外开放，
--   应改为接入 CloudBase 登录（拿到 authenticated 身份）并收紧策略，
--   而不是继续放开 anon。

-- 表级 GRANT：补齐 anon 的写权限
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.orders_id_seq TO anon;

-- 行级 RLS 策略：与 authenticated 的四条保持一致
-- （RLS 默认拒绝一切，不补策略则 anon 连插入都会被拦）

DROP POLICY IF EXISTS orders_anon_select ON public.orders;
CREATE POLICY orders_anon_select ON public.orders
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS orders_anon_insert ON public.orders;
CREATE POLICY orders_anon_insert ON public.orders
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS orders_anon_update ON public.orders;
CREATE POLICY orders_anon_update ON public.orders
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS orders_anon_delete ON public.orders;
CREATE POLICY orders_anon_delete ON public.orders
  FOR DELETE TO anon
  USING (true);
