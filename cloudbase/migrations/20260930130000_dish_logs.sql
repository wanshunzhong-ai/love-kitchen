-- 菜品操作日志（dish_logs）：谁在什么时候动了菜单
--
-- 为什么需要这张表：
--   菜品库（utils/dishes.js）是「本地优先」的 —— seed 内置在代码里，用户改动写各自手机的
--   wx storage。于是干饭人加了一道菜、改了个菜名、下架了某道菜，**只落在 TA 自己手机上**，
--   掌勺人那边的菜单根本不会变，也就永远不知道 TA 动过菜单。
--
--   要让人看见「别人对我这份菜单做了什么」，这条记录就必须走云端 ——
--   这跟订单、忌口是同一个道理：跨设备的信息只有上了云对方才读得到。
--
-- 语义：**append-only 的流水账**
--   每一行是一次已经发生的操作，是「历史事实」，不做修改也不做回滚。
--   菜品后来被删掉了也不要紧 —— dish_name 存的是操作当时的菜名快照，
--   日志永远读得懂（这也是它不能靠 join dishes 表算出来的原因）。
--
-- 权限说明：只给 SELECT + INSERT。
--   审计流水不该被改写，这是它和订单表最大的区别（订单要推进状态、要删单，这里不用）。
--   若日后加「清空历史日志」的功能，再单独开 UPDATE/DELETE 并配套页面入口。
--
-- 写成单个 DO 块的原因：云服务的 SQL 通道走 prepared statement，
-- 一次只接受**一条**语句（多条会报 DATABASE_42601）。包成 DO 块后
-- 「本文件内容」就是「可直接执行的那一条语句」，文件与真库不会走样。

DO $do$
BEGIN
  -- -------------------------------------------------------------------------
  -- 表结构
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.dish_logs (
    id          BIGSERIAL PRIMARY KEY,
    -- 操作类型：加菜 / 改菜 / 下架 / 批量导入
    action      TEXT        NOT NULL,
    -- 目标菜品 id（批量导入没有单一目标，为 NULL）
    dish_id     BIGINT,
    -- 操作当时的菜名快照。菜品后来被删也读得懂，所以不能用外键去 join
    dish_name   TEXT        NOT NULL DEFAULT '',
    -- 改了哪些字段：[{ "field": "菜名", "from": "红烧排骨", "to": "糖醋排骨" }]
    -- 新增 / 下架 / 导入时为空数组
    changes     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- 批量导入的道数；单条操作固定 1
    dish_count  INTEGER     NOT NULL DEFAULT 1,
    -- 谁做的：orderer = 干饭人，cook = 掌勺人
    by_role     TEXT        NOT NULL DEFAULT 'orderer',
    -- 操作当时的昵称快照（对方后来改了称呼，历史日志仍显示当时那个名字）
    by_name     TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT dish_logs_action_check CHECK (action IN ('add', 'update', 'delete', 'import')),
    CONSTRAINT dish_logs_role_check   CHECK (by_role IN ('orderer', 'cook'))
  );

  -- 日志页永远是「按时间倒序取最近 N 条」，这个索引是它的主要入口
  CREATE INDEX IF NOT EXISTS dish_logs_created_at_idx
    ON public.dish_logs (created_at DESC);

  -- -------------------------------------------------------------------------
  -- 权限：与 orders 表同样处理
  --
  -- 直连 PG 时小程序端实际落到的角色是 anon（原因见 20260928160000_orders_anon_grant.sql），
  -- 所以 authenticated 与 anon 都要授。本项目是两人自用的私密小程序，日志不做按人隔离 ——
  -- 谁能进小程序谁就能看全部流水，这正是「掌勺人能查干饭人动过什么」想要的。
  -- -------------------------------------------------------------------------
  GRANT SELECT, INSERT ON public.dish_logs TO authenticated, anon;
  GRANT USAGE, SELECT ON SEQUENCE public.dish_logs_id_seq TO authenticated, anon;

  ALTER TABLE public.dish_logs ENABLE ROW LEVEL SECURITY;

  -- RLS 默认拒绝一切，不补策略连插入都会被拦
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'dish_logs' AND policyname = 'dish_logs_select'
  ) THEN
    EXECUTE 'CREATE POLICY dish_logs_select ON public.dish_logs '
         || 'FOR SELECT TO authenticated, anon USING (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'dish_logs' AND policyname = 'dish_logs_insert'
  ) THEN
    EXECUTE 'CREATE POLICY dish_logs_insert ON public.dish_logs '
         || 'FOR INSERT TO authenticated, anon WITH CHECK (true)';
  END IF;
END
$do$;
