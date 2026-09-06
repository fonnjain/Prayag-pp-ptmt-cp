--
-- PostgreSQL database dump
--

\restrict wv4qhd1NkcQ3eepaQyHnCRXTJNqktNlPfAHCJRQKrn83ctrtHz3AGVNJQUHGD6v

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

SET default_table_access_method = heap;

--
-- Name: ptmt_buffer_multipliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ptmt_buffer_multipliers (
    id integer NOT NULL,
    month text NOT NULL,
    category text NOT NULL,
    multiplier real,
    suggested_multiplier real,
    override_multiplier real,
    z_score real,
    cv_value real,
    data_quality text,
    source_observations integer DEFAULT 0 NOT NULL,
    last_computed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ptmt_buffer_multipliers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ptmt_buffer_multipliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ptmt_buffer_multipliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ptmt_buffer_multipliers_id_seq OWNED BY public.ptmt_buffer_multipliers.id;


--
-- Name: seasonality_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasonality_runs (
    id integer NOT NULL,
    month text NOT NULL,
    segment text NOT NULL,
    engine_kind text NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    details jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: seasonality_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seasonality_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seasonality_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.seasonality_runs_id_seq OWNED BY public.seasonality_runs.id;


--
-- Name: ptmt_buffer_multipliers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ptmt_buffer_multipliers ALTER COLUMN id SET DEFAULT nextval('public.ptmt_buffer_multipliers_id_seq'::regclass);


--
-- Name: seasonality_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasonality_runs ALTER COLUMN id SET DEFAULT nextval('public.seasonality_runs_id_seq'::regclass);


--
-- Name: ptmt_buffer_multipliers ptmt_buffer_multipliers_month_category_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ptmt_buffer_multipliers
    ADD CONSTRAINT ptmt_buffer_multipliers_month_category_unique UNIQUE (month, category);


--
-- Name: ptmt_buffer_multipliers ptmt_buffer_multipliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ptmt_buffer_multipliers
    ADD CONSTRAINT ptmt_buffer_multipliers_pkey PRIMARY KEY (id);


--
-- Name: seasonality_runs seasonality_runs_month_segment_engine_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasonality_runs
    ADD CONSTRAINT seasonality_runs_month_segment_engine_unique UNIQUE (month, segment, engine_kind);


--
-- Name: seasonality_runs seasonality_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasonality_runs
    ADD CONSTRAINT seasonality_runs_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict wv4qhd1NkcQ3eepaQyHnCRXTJNqktNlPfAHCJRQKrn83ctrtHz3AGVNJQUHGD6v

