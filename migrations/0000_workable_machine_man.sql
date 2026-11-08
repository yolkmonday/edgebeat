CREATE TABLE `daily_stats` (
	`monitor_id` text NOT NULL,
	`day` text NOT NULL,
	`checks` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`downtime_s` integer DEFAULT 0 NOT NULL,
	`observed_s` integer DEFAULT 0 NOT NULL,
	`hist` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`monitor_id`, `day`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`monitor_id` text NOT NULL,
	`from_state` text NOT NULL,
	`to_state` text NOT NULL,
	`at` integer NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_monitor_at_idx` ON `events` (`monitor_id`,`at`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_slug_unique` ON `groups` (`slug`);--> statement-breakpoint
CREATE TABLE `heartbeats` (
	`monitor_id` text PRIMARY KEY NOT NULL,
	`last_beat_at` integer,
	`last_fail_at` integer,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `monitor_state` (
	`monitor_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_change_at` integer NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `monitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`group_id` text,
	`url` text,
	`method` text DEFAULT 'GET' NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`body` text,
	`expected_status` text DEFAULT '200-399' NOT NULL,
	`timeout_ms` integer DEFAULT 10000 NOT NULL,
	`follow_redirects` integer DEFAULT 1 NOT NULL,
	`keyword` text,
	`keyword_mode` text DEFAULT 'contains' NOT NULL,
	`host` text,
	`port` integer,
	`interval_min` integer DEFAULT 1 NOT NULL,
	`confirmations` integer DEFAULT 2 NOT NULL,
	`degraded_threshold_ms` integer,
	`heartbeat_period_s` integer,
	`heartbeat_grace_s` integer,
	`heartbeat_token` text,
	`is_public` integer DEFAULT 1 NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monitors_slug_unique` ON `monitors` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `monitors_heartbeat_token_unique` ON `monitors` (`heartbeat_token`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshot` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_tick_at` integer NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`current` text NOT NULL,
	`bars` text NOT NULL,
	`carry` text DEFAULT '[]' NOT NULL,
	`last_rollup_minute` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ticks` (
	`minute` integer PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`results` text NOT NULL
);
