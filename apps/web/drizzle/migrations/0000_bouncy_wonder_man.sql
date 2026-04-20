CREATE TYPE "public"."continent" AS ENUM('africa', 'asia', 'europe', 'north_america', 'oceania', 'south_america');--> statement-breakpoint
CREATE TYPE "public"."foot" AS ENUM('left', 'right', 'both', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."trophy_scope" AS ENUM('uefa', 'conmebol', 'concacaf', 'national', 'world');--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tm_id" integer,
	"name" text NOT NULL,
	"league_id" integer,
	"country_id" integer,
	CONSTRAINT "clubs_tm_id_unique" UNIQUE("tm_id")
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tm_id" text,
	"name" text NOT NULL,
	"continent" "continent" NOT NULL,
	CONSTRAINT "countries_tm_id_unique" UNIQUE("tm_id"),
	CONSTRAINT "countries_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "daily_targets" (
	"date" date PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" serial PRIMARY KEY NOT NULL,
	"tm_id" text,
	"name" text NOT NULL,
	"country_id" integer,
	"tier" smallint DEFAULT 1 NOT NULL,
	"is_top5_european" boolean DEFAULT false NOT NULL,
	CONSTRAINT "leagues_tm_id_unique" UNIQUE("tm_id")
);
--> statement-breakpoint
CREATE TABLE "player_teammates" (
	"player_a_id" integer NOT NULL,
	"player_b_id" integer NOT NULL,
	"seasons_overlapped" smallint NOT NULL,
	CONSTRAINT "player_teammates_player_a_id_player_b_id_pk" PRIMARY KEY("player_a_id","player_b_id")
);
--> statement-breakpoint
CREATE TABLE "player_trophies" (
	"player_id" integer NOT NULL,
	"trophy_id" integer NOT NULL,
	"year" smallint NOT NULL,
	CONSTRAINT "player_trophies_player_id_trophy_id_year_pk" PRIMARY KEY("player_id","trophy_id","year")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"tm_id" integer,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"dob" date,
	"height_cm" smallint,
	"foot" "foot" DEFAULT 'unknown' NOT NULL,
	"primary_position" text,
	"generic_position" text,
	"current_club_id" integer,
	"current_jersey_number" smallint,
	"market_value_eur" bigint,
	"country_of_citizenship_id" integer,
	"country_of_birth_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"photo_url" text,
	CONSTRAINT "players_tm_id_unique" UNIQUE("tm_id"),
	CONSTRAINT "players_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"from_club_id" integer,
	"to_club_id" integer,
	"season" smallint NOT NULL,
	"transfer_date" date,
	"fee_eur" bigint,
	"market_value_eur" bigint
);
--> statement-breakpoint
CREATE TABLE "trophies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scope" "trophy_scope" NOT NULL,
	CONSTRAINT "trophies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_targets" ADD CONSTRAINT "daily_targets_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_teammates" ADD CONSTRAINT "player_teammates_player_a_id_players_id_fk" FOREIGN KEY ("player_a_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_teammates" ADD CONSTRAINT "player_teammates_player_b_id_players_id_fk" FOREIGN KEY ("player_b_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trophies" ADD CONSTRAINT "player_trophies_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trophies" ADD CONSTRAINT "player_trophies_trophy_id_trophies_id_fk" FOREIGN KEY ("trophy_id") REFERENCES "public"."trophies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_current_club_id_clubs_id_fk" FOREIGN KEY ("current_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_country_of_citizenship_id_countries_id_fk" FOREIGN KEY ("country_of_citizenship_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_country_of_birth_id_countries_id_fk" FOREIGN KEY ("country_of_birth_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_club_id_clubs_id_fk" FOREIGN KEY ("from_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_club_id_clubs_id_fk" FOREIGN KEY ("to_club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clubs_league_idx" ON "clubs" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "teammates_b_idx" ON "player_teammates" USING btree ("player_b_id");--> statement-breakpoint
CREATE INDEX "players_name_idx" ON "players" USING btree ("name");--> statement-breakpoint
CREATE INDEX "players_slug_idx" ON "players" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "players_club_idx" ON "players" USING btree ("current_club_id");--> statement-breakpoint
CREATE INDEX "players_active_idx" ON "players" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "players_citizenship_idx" ON "players" USING btree ("country_of_citizenship_id");--> statement-breakpoint
CREATE INDEX "transfers_player_idx" ON "transfers" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "transfers_from_club_idx" ON "transfers" USING btree ("from_club_id");--> statement-breakpoint
CREATE INDEX "transfers_to_club_idx" ON "transfers" USING btree ("to_club_id");--> statement-breakpoint
CREATE INDEX "transfers_season_idx" ON "transfers" USING btree ("season");