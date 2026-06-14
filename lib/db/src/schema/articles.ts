import {
  pgTable,
  bigserial,
  text,
  numeric,
  boolean,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const articles = pgTable(
  "articles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    articleCode: text("article_code").notNull(),
    articleName: text("article_name"),
    division: text("division").notNull(),
  },
  (t) => [
    unique("articles_uq").on(t.articleCode, t.division),
    check("articles_division_chk", sql`${t.division} in ('PTMT','CP')`),
  ],
);

export const modelArticles = pgTable(
  "model_articles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    division: text("division").notNull(),
    model: text("model").notNull(),
    articleCode: text("article_code").notNull(),
    price: numeric("price"),
    receive: boolean("receive").default(true),
  },
  (t) => [
    unique("model_articles_uq").on(t.division, t.model, t.articleCode),
    check("model_articles_division_chk", sql`${t.division} in ('PTMT','CP')`),
  ],
);

export type Article = typeof articles.$inferSelect;
export type ModelArticle = typeof modelArticles.$inferSelect;
