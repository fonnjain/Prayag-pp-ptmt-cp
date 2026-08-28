--
-- PostgreSQL database dump
--

\restrict BQUI9FgTYPtK9hHrgRdGIHssar1hUvbjWqfJPxHZ41DwrJoXeasokuu19Znzhes

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: prevent_plant_plan_version_content_rewrite(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_plant_plan_version_content_rewrite() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.month IS DISTINCT FROM OLD.month
    OR NEW.segment IS DISTINCT FROM OLD.segment
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.targets_json IS DISTINCT FROM OLD.targets_json
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'issued plant plan version content is immutable';
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migrations (
    filename text NOT NULL,
    applied_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_analyses (
    id integer NOT NULL,
    month text NOT NULL,
    snapshot_date text,
    depth text DEFAULT 'standard'::text NOT NULL,
    model text NOT NULL,
    packet_hash text NOT NULL,
    packet_json jsonb NOT NULL,
    result_json jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_analyses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_analyses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_analyses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_analyses_id_seq OWNED BY public.ai_analyses.id;


--
-- Name: ai_analysis_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_analysis_messages (
    id integer NOT NULL,
    analysis_id integer NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_analysis_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_analysis_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_analysis_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_analysis_messages_id_seq OWNED BY public.ai_analysis_messages.id;


--
-- Name: ai_plant_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_plant_analyses (
    id integer NOT NULL,
    month text NOT NULL,
    snapshot_date text,
    depth text DEFAULT 'standard'::text NOT NULL,
    model text NOT NULL,
    packet_hash text NOT NULL,
    packet_json jsonb NOT NULL,
    result_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_plant_analyses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_plant_analyses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_plant_analyses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_plant_analyses_id_seq OWNED BY public.ai_plant_analyses.id;


--
-- Name: ai_plant_analysis_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_plant_analysis_messages (
    id integer NOT NULL,
    analysis_id integer NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_plant_analysis_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_plant_analysis_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_plant_analysis_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_plant_analysis_messages_id_seq OWNED BY public.ai_plant_analysis_messages.id;


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    key_hash text NOT NULL,
    key_prefix text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    consumer text DEFAULT 'legacy'::text NOT NULL,
    scopes text[] DEFAULT ARRAY['read'::text, 'write'::text] NOT NULL,
    segment_scopes text[] DEFAULT ARRAY['PTMT'::text, 'Plumbing'::text] NOT NULL
);


--
-- Name: api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;


--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_users (
    id integer NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text])))
);


--
-- Name: app_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_users_id_seq OWNED BY public.app_users.id;


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id bigint NOT NULL,
    token_hash text NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.auth_sessions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auth_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buffer_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buffer_categories (
    id integer NOT NULL,
    name text NOT NULL,
    multiplier real DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    suggested_multiplier real,
    override_multiplier real,
    cv_value real,
    volatility_class text,
    avg_month real,
    peak_month text,
    peak_index real,
    yoy real,
    signal text,
    seasonal_indices text,
    last_computed_at timestamp with time zone,
    data_quality text,
    z_score real,
    segment text DEFAULT 'PTMT'::text NOT NULL,
    reliability_flag text
);


--
-- Name: buffer_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.buffer_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: buffer_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.buffer_categories_id_seq OWNED BY public.buffer_categories.id;


--
-- Name: category_capacity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_capacity (
    id integer NOT NULL,
    category text NOT NULL,
    mean_per_day real DEFAULT 0 NOT NULL,
    p90_per_day real DEFAULT 0 NOT NULL,
    best_day real DEFAULT 0 NOT NULL,
    days_observed integer DEFAULT 0 NOT NULL,
    trailing_days integer DEFAULT 90 NOT NULL,
    is_thin_data integer DEFAULT 0 NOT NULL,
    suggested_capacity real DEFAULT 0 NOT NULL,
    override_capacity real,
    working_days_per_week integer DEFAULT 6 NOT NULL,
    plan_needs_per_day real DEFAULT 0 NOT NULL,
    last_computed_at timestamp without time zone DEFAULT now() NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL
);


--
-- Name: category_capacity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.category_capacity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: category_capacity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.category_capacity_id_seq OWNED BY public.category_capacity.id;


--
-- Name: corrective_plan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corrective_plan_items (
    id integer NOT NULL,
    run_id integer NOT NULL,
    item_code text NOT NULL,
    colour text NOT NULL,
    category text NOT NULL,
    avg_3mo_sale real DEFAULT 0 NOT NULL,
    buffer_multiplier real DEFAULT 1 NOT NULL,
    stock_open real DEFAULT 0 NOT NULL,
    produced_to_date real DEFAULT 0 NOT NULL,
    stock_now real DEFAULT 0 NOT NULL,
    pending_at_plan real DEFAULT 0 NOT NULL,
    pending_now real DEFAULT 0 NOT NULL,
    pending_last_month real DEFAULT 0 NOT NULL,
    original_plan real DEFAULT 0 NOT NULL,
    original_week integer,
    buffer_req_rev real DEFAULT 0 NOT NULL,
    plan_rev real DEFAULT 0 NOT NULL,
    remaining_to_produce real DEFAULT 0 NOT NULL,
    delta_new_orders real DEFAULT 0 NOT NULL,
    delta_production real DEFAULT 0 NOT NULL,
    delta_net real DEFAULT 0 NOT NULL,
    cover_now real,
    new_week integer,
    w1_rev real DEFAULT 0 NOT NULL,
    w2_rev real DEFAULT 0 NOT NULL,
    w3_rev real DEFAULT 0 NOT NULL,
    w4_rev real DEFAULT 0 NOT NULL,
    status text DEFAULT 'on-plan'::text NOT NULL,
    is_new_item integer DEFAULT 0 NOT NULL,
    kg_rev real DEFAULT 0 NOT NULL,
    remaining_kg real DEFAULT 0 NOT NULL
);


--
-- Name: corrective_plan_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.corrective_plan_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: corrective_plan_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.corrective_plan_items_id_seq OWNED BY public.corrective_plan_items.id;


--
-- Name: corrective_plan_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corrective_plan_runs (
    id integer NOT NULL,
    month text NOT NULL,
    week_closed integer DEFAULT 0 NOT NULL,
    daily_capacity real DEFAULT 21335 NOT NULL,
    working_days_per_week integer DEFAULT 6 NOT NULL,
    produced_to_date real DEFAULT 0 NOT NULL,
    new_orders_qty real DEFAULT 0 NOT NULL,
    original_month_total real DEFAULT 0 NOT NULL,
    revised_month_total real DEFAULT 0 NOT NULL,
    unfulfillable_qty real DEFAULT 0 NOT NULL,
    week_stats_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    warnings_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL,
    as_of_date text,
    note text,
    plan_run_id integer,
    fingerprint text,
    categories_json jsonb,
    working_days_remaining integer,
    pinned boolean DEFAULT false NOT NULL,
    frozen_plan_grand_max integer,
    effective_from text
);


--
-- Name: corrective_plan_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.corrective_plan_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: corrective_plan_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.corrective_plan_runs_id_seq OWNED BY public.corrective_plan_runs.id;


--
-- Name: ideal_hours_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ideal_hours_overrides (
    id integer NOT NULL,
    machine_id text NOT NULL,
    month text NOT NULL,
    hours numeric(12,2) NOT NULL
);


--
-- Name: ideal_hours_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ideal_hours_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ideal_hours_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ideal_hours_overrides_id_seq OWNED BY public.ideal_hours_overrides.id;


--
-- Name: item_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_master (
    id integer NOT NULL,
    category text NOT NULL,
    item_code text NOT NULL,
    colour text NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL
);


--
-- Name: item_master_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_master_id_seq OWNED BY public.item_master.id;


--
-- Name: item_weights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_weights (
    id integer NOT NULL,
    item_code text NOT NULL,
    colour text DEFAULT ''::text NOT NULL,
    weight_kg numeric(12,4)
);


--
-- Name: item_weights_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_weights_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_weights_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_weights_id_seq OWNED BY public.item_weights.id;


--
-- Name: monitoring_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitoring_config (
    month text NOT NULL,
    working_days integer DEFAULT 27 NOT NULL,
    shifts_per_day integer DEFAULT 2 NOT NULL,
    shift_hours integer DEFAULT 12 NOT NULL,
    snapshot_date text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL
);


--
-- Name: monitoring_thresholds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monitoring_thresholds (
    code text NOT NULL,
    threshold_json jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pending_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_snapshots (
    id integer NOT NULL,
    run_id integer NOT NULL,
    cat_no text NOT NULL,
    colour text NOT NULL,
    qty real DEFAULT 0 NOT NULL
);


--
-- Name: pending_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pending_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pending_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pending_snapshots_id_seq OWNED BY public.pending_snapshots.id;


--
-- Name: plan_run_input_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_run_input_snapshots (
    id integer NOT NULL,
    run_id integer NOT NULL,
    segment text NOT NULL,
    source_role text NOT NULL,
    source_kind text NOT NULL,
    source_upload_id integer,
    source_filename text,
    source_uploaded_at timestamp with time zone,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_rows_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    parsed_rows_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    diagnostics_json jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: plan_run_input_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plan_run_input_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plan_run_input_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plan_run_input_snapshots_id_seq OWNED BY public.plan_run_input_snapshots.id;


--
-- Name: plan_run_inputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_run_inputs (
    id integer NOT NULL,
    run_id integer NOT NULL,
    item_code text NOT NULL,
    colour text NOT NULL,
    avg_3mo_sale real DEFAULT 0 NOT NULL,
    stock real DEFAULT 0 NOT NULL,
    pending_current real DEFAULT 0 NOT NULL,
    pending_last_month real DEFAULT 0 NOT NULL
);


--
-- Name: plan_run_inputs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plan_run_inputs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plan_run_inputs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plan_run_inputs_id_seq OWNED BY public.plan_run_inputs.id;


--
-- Name: plan_run_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_run_results (
    id integer NOT NULL,
    run_id integer NOT NULL,
    item_code text NOT NULL,
    colour text NOT NULL,
    category text NOT NULL,
    buffer_req real DEFAULT 0 NOT NULL,
    min_production real DEFAULT 0 NOT NULL,
    production_plan real DEFAULT 0 NOT NULL,
    release_week integer,
    w1 real DEFAULT 0 NOT NULL,
    w2 real DEFAULT 0 NOT NULL,
    w3 real DEFAULT 0 NOT NULL,
    w4 real DEFAULT 0 NOT NULL
);


--
-- Name: plan_run_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plan_run_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plan_run_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plan_run_results_id_seq OWNED BY public.plan_run_results.id;


--
-- Name: plan_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_runs (
    id integer NOT NULL,
    month text NOT NULL,
    as_of_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    factors_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL,
    effective_from text,
    weekly_release_version integer DEFAULT 0 NOT NULL
);


--
-- Name: plan_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plan_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plan_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plan_runs_id_seq OWNED BY public.plan_runs.id;


--
-- Name: plant_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plant_configs (
    month text NOT NULL,
    working_days integer,
    shifts_per_day integer DEFAULT 2 NOT NULL,
    shift_hours integer DEFAULT 12 NOT NULL,
    snapshot_date text,
    thresholds_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL
);


--
-- Name: plant_ingestion_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plant_ingestion_cache (
    month text NOT NULL,
    snapshot_date text DEFAULT ''::text NOT NULL,
    raw_actuals_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    cached_at timestamp with time zone DEFAULT now() NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL
);


--
-- Name: plant_month_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plant_month_snapshots (
    id integer NOT NULL,
    month text NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL,
    payload_json jsonb NOT NULL,
    source_plan_versions_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    closed_at timestamp with time zone NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    captured_commit_sha text,
    backfilled boolean DEFAULT false NOT NULL,
    plan_status text DEFAULT 'finalized'::text NOT NULL,
    plan_status_reason text,
    plan_evidence_json jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: plant_month_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plant_month_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plant_month_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plant_month_snapshots_id_seq OWNED BY public.plant_month_snapshots.id;


--
-- Name: plant_plan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plant_plan_items (
    id integer NOT NULL,
    upload_id integer NOT NULL,
    item_type text NOT NULL,
    item_code text NOT NULL,
    material text NOT NULL,
    requested_pcs real DEFAULT 0 NOT NULL,
    feasible_pcs real DEFAULT 0 NOT NULL,
    shortfall_pcs real DEFAULT 0 NOT NULL,
    requested_kg real DEFAULT 0 NOT NULL,
    feasible_kg real DEFAULT 0 NOT NULL,
    shortfall_kg real DEFAULT 0 NOT NULL,
    machines text,
    note text,
    machine_hrs real DEFAULT 0 NOT NULL
);


--
-- Name: plant_plan_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plant_plan_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plant_plan_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plant_plan_items_id_seq OWNED BY public.plant_plan_items.id;


--
-- Name: plant_plan_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plant_plan_uploads (
    id integer NOT NULL,
    month text NOT NULL,
    segment text DEFAULT 'Plumbing'::text NOT NULL,
    filename text NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    summary_json jsonb,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_from text
);


--
-- Name: plant_plan_uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plant_plan_uploads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plant_plan_uploads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plant_plan_uploads_id_seq OWNED BY public.plant_plan_uploads.id;


--
-- Name: plant_plan_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plant_plan_versions (
    id integer NOT NULL,
    month text NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL,
    kind text NOT NULL,
    source_id integer NOT NULL,
    effective_from text NOT NULL,
    source_label text,
    targets_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: plant_plan_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plant_plan_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plant_plan_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plant_plan_versions_id_seq OWNED BY public.plant_plan_versions.id;


--
-- Name: plant_source_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plant_source_configs (
    month text NOT NULL,
    file_id text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL
);


--
-- Name: plumbing_machine_capacity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plumbing_machine_capacity (
    id integer NOT NULL,
    segment text DEFAULT 'Plumbing'::text NOT NULL,
    pool text NOT NULL,
    machine_id text NOT NULL,
    label text,
    shifts_per_day real DEFAULT 2 NOT NULL,
    hours_per_shift real DEFAULT 10 NOT NULL,
    working_days integer DEFAULT 25 NOT NULL,
    rates jsonb DEFAULT '{}'::jsonb NOT NULL,
    locked_out boolean DEFAULT false NOT NULL
);


--
-- Name: plumbing_machine_capacity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plumbing_machine_capacity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plumbing_machine_capacity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plumbing_machine_capacity_id_seq OWNED BY public.plumbing_machine_capacity.id;


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id integer NOT NULL,
    type text NOT NULL,
    month text NOT NULL,
    snapshot_date text,
    filename text NOT NULL,
    data_base64 text NOT NULL,
    content_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reports_id_seq OWNED BY public.reports.id;


--
-- Name: sync_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_sources (
    id text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'idle'::text NOT NULL,
    message text,
    rows jsonb,
    last_synced_at timestamp with time zone
);


--
-- Name: uploaded_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploaded_files (
    id integer NOT NULL,
    kind text NOT NULL,
    filename text NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    rows jsonb NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: uploaded_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.uploaded_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: uploaded_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.uploaded_files_id_seq OWNED BY public.uploaded_files.id;


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_sessions_id_seq OWNED BY public.user_sessions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    must_change_password boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: weekly_release_bands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_release_bands (
    id integer NOT NULL,
    category_name text NOT NULL,
    w1_upper real NOT NULL,
    w2_upper real NOT NULL,
    w3_upper real NOT NULL,
    w4_upper real NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    segment text DEFAULT 'PTMT'::text NOT NULL
);


--
-- Name: weekly_release_bands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.weekly_release_bands_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: weekly_release_bands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.weekly_release_bands_id_seq OWNED BY public.weekly_release_bands.id;


--
-- Name: workbook_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workbook_config (
    id text NOT NULL,
    division text NOT NULL,
    month text NOT NULL,
    workbook_id text NOT NULL,
    label text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_analyses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analyses ALTER COLUMN id SET DEFAULT nextval('public.ai_analyses_id_seq'::regclass);


--
-- Name: ai_analysis_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_messages ALTER COLUMN id SET DEFAULT nextval('public.ai_analysis_messages_id_seq'::regclass);


--
-- Name: ai_plant_analyses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_plant_analyses ALTER COLUMN id SET DEFAULT nextval('public.ai_plant_analyses_id_seq'::regclass);


--
-- Name: ai_plant_analysis_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_plant_analysis_messages ALTER COLUMN id SET DEFAULT nextval('public.ai_plant_analysis_messages_id_seq'::regclass);


--
-- Name: api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);


--
-- Name: app_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users ALTER COLUMN id SET DEFAULT nextval('public.app_users_id_seq'::regclass);


--
-- Name: buffer_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buffer_categories ALTER COLUMN id SET DEFAULT nextval('public.buffer_categories_id_seq'::regclass);


--
-- Name: category_capacity id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_capacity ALTER COLUMN id SET DEFAULT nextval('public.category_capacity_id_seq'::regclass);


--
-- Name: corrective_plan_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_plan_items ALTER COLUMN id SET DEFAULT nextval('public.corrective_plan_items_id_seq'::regclass);


--
-- Name: corrective_plan_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_plan_runs ALTER COLUMN id SET DEFAULT nextval('public.corrective_plan_runs_id_seq'::regclass);


--
-- Name: ideal_hours_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ideal_hours_overrides ALTER COLUMN id SET DEFAULT nextval('public.ideal_hours_overrides_id_seq'::regclass);


--
-- Name: item_master id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_master ALTER COLUMN id SET DEFAULT nextval('public.item_master_id_seq'::regclass);


--
-- Name: item_weights id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_weights ALTER COLUMN id SET DEFAULT nextval('public.item_weights_id_seq'::regclass);


--
-- Name: pending_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_snapshots ALTER COLUMN id SET DEFAULT nextval('public.pending_snapshots_id_seq'::regclass);


--
-- Name: plan_run_input_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_input_snapshots ALTER COLUMN id SET DEFAULT nextval('public.plan_run_input_snapshots_id_seq'::regclass);


--
-- Name: plan_run_inputs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_inputs ALTER COLUMN id SET DEFAULT nextval('public.plan_run_inputs_id_seq'::regclass);


--
-- Name: plan_run_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_results ALTER COLUMN id SET DEFAULT nextval('public.plan_run_results_id_seq'::regclass);


--
-- Name: plan_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_runs ALTER COLUMN id SET DEFAULT nextval('public.plan_runs_id_seq'::regclass);


--
-- Name: plant_month_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_month_snapshots ALTER COLUMN id SET DEFAULT nextval('public.plant_month_snapshots_id_seq'::regclass);


--
-- Name: plant_plan_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_plan_items ALTER COLUMN id SET DEFAULT nextval('public.plant_plan_items_id_seq'::regclass);


--
-- Name: plant_plan_uploads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_plan_uploads ALTER COLUMN id SET DEFAULT nextval('public.plant_plan_uploads_id_seq'::regclass);


--
-- Name: plant_plan_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_plan_versions ALTER COLUMN id SET DEFAULT nextval('public.plant_plan_versions_id_seq'::regclass);


--
-- Name: plumbing_machine_capacity id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plumbing_machine_capacity ALTER COLUMN id SET DEFAULT nextval('public.plumbing_machine_capacity_id_seq'::regclass);


--
-- Name: reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports ALTER COLUMN id SET DEFAULT nextval('public.reports_id_seq'::regclass);


--
-- Name: uploaded_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files ALTER COLUMN id SET DEFAULT nextval('public.uploaded_files_id_seq'::regclass);


--
-- Name: user_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions ALTER COLUMN id SET DEFAULT nextval('public.user_sessions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: weekly_release_bands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_release_bands ALTER COLUMN id SET DEFAULT nextval('public.weekly_release_bands_id_seq'::regclass);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (filename);


--
-- Name: ai_analyses ai_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analyses
    ADD CONSTRAINT ai_analyses_pkey PRIMARY KEY (id);


--
-- Name: ai_analysis_messages ai_analysis_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_messages
    ADD CONSTRAINT ai_analysis_messages_pkey PRIMARY KEY (id);


--
-- Name: ai_plant_analyses ai_plant_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_plant_analyses
    ADD CONSTRAINT ai_plant_analyses_pkey PRIMARY KEY (id);


--
-- Name: ai_plant_analysis_messages ai_plant_analysis_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_plant_analysis_messages
    ADD CONSTRAINT ai_plant_analysis_messages_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: buffer_categories buffer_categories_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buffer_categories
    ADD CONSTRAINT buffer_categories_name_unique UNIQUE (name);


--
-- Name: buffer_categories buffer_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buffer_categories
    ADD CONSTRAINT buffer_categories_pkey PRIMARY KEY (id);


--
-- Name: category_capacity category_capacity_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_capacity
    ADD CONSTRAINT category_capacity_category_key UNIQUE (category);


--
-- Name: category_capacity category_capacity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_capacity
    ADD CONSTRAINT category_capacity_pkey PRIMARY KEY (id);


--
-- Name: corrective_plan_items corrective_plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_plan_items
    ADD CONSTRAINT corrective_plan_items_pkey PRIMARY KEY (id);


--
-- Name: corrective_plan_runs corrective_plan_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_plan_runs
    ADD CONSTRAINT corrective_plan_runs_pkey PRIMARY KEY (id);


--
-- Name: ideal_hours_overrides ideal_hours_overrides_machine_id_month_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ideal_hours_overrides
    ADD CONSTRAINT ideal_hours_overrides_machine_id_month_unique UNIQUE (machine_id, month);


--
-- Name: ideal_hours_overrides ideal_hours_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ideal_hours_overrides
    ADD CONSTRAINT ideal_hours_overrides_pkey PRIMARY KEY (id);


--
-- Name: item_master item_master_item_code_colour_category_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_master
    ADD CONSTRAINT item_master_item_code_colour_category_unique UNIQUE (item_code, colour, category);


--
-- Name: item_master item_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_master
    ADD CONSTRAINT item_master_pkey PRIMARY KEY (id);


--
-- Name: item_weights item_weights_item_code_colour_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_weights
    ADD CONSTRAINT item_weights_item_code_colour_unique UNIQUE (item_code, colour);


--
-- Name: item_weights item_weights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_weights
    ADD CONSTRAINT item_weights_pkey PRIMARY KEY (id);


--
-- Name: monitoring_config monitoring_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitoring_config
    ADD CONSTRAINT monitoring_config_pkey PRIMARY KEY (month, segment);


--
-- Name: monitoring_thresholds monitoring_thresholds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monitoring_thresholds
    ADD CONSTRAINT monitoring_thresholds_pkey PRIMARY KEY (code);


--
-- Name: pending_snapshots pending_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_snapshots
    ADD CONSTRAINT pending_snapshots_pkey PRIMARY KEY (id);


--
-- Name: plan_run_input_snapshots plan_run_input_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_input_snapshots
    ADD CONSTRAINT plan_run_input_snapshots_pkey PRIMARY KEY (id);


--
-- Name: plan_run_input_snapshots plan_run_input_snapshots_run_role_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_input_snapshots
    ADD CONSTRAINT plan_run_input_snapshots_run_role_unique UNIQUE (run_id, source_role);


--
-- Name: plan_run_inputs plan_run_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_inputs
    ADD CONSTRAINT plan_run_inputs_pkey PRIMARY KEY (id);


--
-- Name: plan_run_results plan_run_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_results
    ADD CONSTRAINT plan_run_results_pkey PRIMARY KEY (id);


--
-- Name: plan_runs plan_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_runs
    ADD CONSTRAINT plan_runs_pkey PRIMARY KEY (id);


--
-- Name: plant_configs plant_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_configs
    ADD CONSTRAINT plant_configs_pkey PRIMARY KEY (month, segment);


--
-- Name: plant_ingestion_cache plant_ingestion_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_ingestion_cache
    ADD CONSTRAINT plant_ingestion_cache_pkey PRIMARY KEY (month, segment);


--
-- Name: plant_month_snapshots plant_month_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_month_snapshots
    ADD CONSTRAINT plant_month_snapshots_pkey PRIMARY KEY (id);


--
-- Name: plant_plan_items plant_plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_plan_items
    ADD CONSTRAINT plant_plan_items_pkey PRIMARY KEY (id);


--
-- Name: plant_plan_uploads plant_plan_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_plan_uploads
    ADD CONSTRAINT plant_plan_uploads_pkey PRIMARY KEY (id);


--
-- Name: plant_plan_versions plant_plan_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_plan_versions
    ADD CONSTRAINT plant_plan_versions_pkey PRIMARY KEY (id);


--
-- Name: plant_source_configs plant_source_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_source_configs
    ADD CONSTRAINT plant_source_configs_pkey PRIMARY KEY (month, segment);


--
-- Name: plumbing_machine_capacity plumbing_machine_capacity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plumbing_machine_capacity
    ADD CONSTRAINT plumbing_machine_capacity_pkey PRIMARY KEY (id);


--
-- Name: plumbing_machine_capacity plumbing_machine_capacity_segment_machine_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plumbing_machine_capacity
    ADD CONSTRAINT plumbing_machine_capacity_segment_machine_id_key UNIQUE (segment, machine_id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: sync_sources sync_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_sources
    ADD CONSTRAINT sync_sources_pkey PRIMARY KEY (id);


--
-- Name: uploaded_files uploaded_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: weekly_release_bands weekly_release_bands_category_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_release_bands
    ADD CONSTRAINT weekly_release_bands_category_name_key UNIQUE (category_name);


--
-- Name: weekly_release_bands weekly_release_bands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_release_bands
    ADD CONSTRAINT weekly_release_bands_pkey PRIMARY KEY (id);


--
-- Name: workbook_config workbook_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workbook_config
    ADD CONSTRAINT workbook_config_pkey PRIMARY KEY (id);


--
-- Name: ai_plant_analyses_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_plant_analyses_month_idx ON public.ai_plant_analyses USING btree (month);


--
-- Name: ai_plant_analyses_packet_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_plant_analyses_packet_hash_idx ON public.ai_plant_analyses USING btree (packet_hash);


--
-- Name: ai_plant_analysis_messages_analysis_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_plant_analysis_messages_analysis_id_idx ON public.ai_plant_analysis_messages USING btree (analysis_id);


--
-- Name: app_users_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_users_email_unique ON public.app_users USING btree (email);


--
-- Name: auth_sessions_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_expiry_idx ON public.auth_sessions USING btree (expires_at);


--
-- Name: auth_sessions_token_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_sessions_token_unique ON public.auth_sessions USING btree (token_hash);


--
-- Name: auth_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_user_idx ON public.auth_sessions USING btree (user_id);


--
-- Name: corrective_plan_items_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX corrective_plan_items_run_id_idx ON public.corrective_plan_items USING btree (run_id);


--
-- Name: idx_corrective_runs_seg_month_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corrective_runs_seg_month_id ON public.corrective_plan_runs USING btree (segment, month, id DESC);


--
-- Name: idx_user_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_expires_at ON public.user_sessions USING btree (expires_at);


--
-- Name: idx_user_sessions_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_token_hash ON public.user_sessions USING btree (token_hash);


--
-- Name: idx_user_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_user_id ON public.user_sessions USING btree (user_id);


--
-- Name: pending_snapshots_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_snapshots_run_id_idx ON public.pending_snapshots USING btree (run_id);


--
-- Name: plan_run_input_snapshots_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_run_input_snapshots_run_id_idx ON public.plan_run_input_snapshots USING btree (run_id);


--
-- Name: plan_run_inputs_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_run_inputs_run_id_idx ON public.plan_run_inputs USING btree (run_id);


--
-- Name: plan_run_results_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_run_results_run_id_idx ON public.plan_run_results USING btree (run_id);


--
-- Name: plan_runs_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_runs_month_idx ON public.plan_runs USING btree (month);


--
-- Name: plant_month_snapshots_month_segment_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX plant_month_snapshots_month_segment_unique ON public.plant_month_snapshots USING btree (month, segment);


--
-- Name: plant_plan_items_upload_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plant_plan_items_upload_id ON public.plant_plan_items USING btree (upload_id);


--
-- Name: plant_plan_uploads_month_segment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plant_plan_uploads_month_segment ON public.plant_plan_uploads USING btree (month, segment, uploaded_at DESC);


--
-- Name: plant_plan_versions_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX plant_plan_versions_source_unique ON public.plant_plan_versions USING btree (kind, source_id);


--
-- Name: reports_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_month_idx ON public.reports USING btree (month);


--
-- Name: reports_type_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_type_month_idx ON public.reports USING btree (type, month);


--
-- Name: plant_plan_versions plant_plan_versions_content_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER plant_plan_versions_content_immutable BEFORE UPDATE ON public.plant_plan_versions FOR EACH ROW EXECUTE FUNCTION public.prevent_plant_plan_version_content_rewrite();


--
-- Name: auth_sessions auth_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;


--
-- Name: corrective_plan_items corrective_plan_items_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_plan_items
    ADD CONSTRAINT corrective_plan_items_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.corrective_plan_runs(id) ON DELETE CASCADE;


--
-- Name: corrective_plan_runs corrective_plan_runs_plan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_plan_runs
    ADD CONSTRAINT corrective_plan_runs_plan_run_id_fkey FOREIGN KEY (plan_run_id) REFERENCES public.plan_runs(id) ON DELETE SET NULL;


--
-- Name: pending_snapshots pending_snapshots_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_snapshots
    ADD CONSTRAINT pending_snapshots_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.plan_runs(id) ON DELETE CASCADE;


--
-- Name: plan_run_input_snapshots plan_run_input_snapshots_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_input_snapshots
    ADD CONSTRAINT plan_run_input_snapshots_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.plan_runs(id) ON DELETE CASCADE;


--
-- Name: plan_run_inputs plan_run_inputs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_inputs
    ADD CONSTRAINT plan_run_inputs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.plan_runs(id) ON DELETE CASCADE;


--
-- Name: plan_run_results plan_run_results_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_run_results
    ADD CONSTRAINT plan_run_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.plan_runs(id) ON DELETE CASCADE;


--
-- Name: plant_plan_items plant_plan_items_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plant_plan_items
    ADD CONSTRAINT plant_plan_items_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.plant_plan_uploads(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict BQUI9FgTYPtK9hHrgRdGIHssar1hUvbjWqfJPxHZ41DwrJoXeasokuu19Znzhes

