CREATE TABLE `waitlist_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`kind` text NOT NULL,
	`city` text,
	`subject` text NOT NULL,
	`encrypted_body` text NOT NULL,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_campaign_idempotency` ON `waitlist_campaigns` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `waitlist_email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`signup_id` text NOT NULL,
	`campaign_id` text,
	`kind` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`provider_id` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`signup_id`) REFERENCES `waitlist_signups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_outbox_idempotency` ON `waitlist_email_outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `waitlist_outbox_status` ON `waitlist_email_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `waitlist_outbox_signup` ON `waitlist_email_outbox` (`signup_id`);--> statement-breakpoint
CREATE TABLE `waitlist_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`hits` integer DEFAULT 1 NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `waitlist_signups` (
	`id` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`encrypted_data` text NOT NULL,
	`city` text NOT NULL,
	`city_key` text NOT NULL,
	`gender_key` text NOT NULL,
	`age_key` text NOT NULL,
	`source` text NOT NULL,
	`utm_source` text DEFAULT '' NOT NULL,
	`utm_medium` text DEFAULT '' NOT NULL,
	`utm_campaign` text DEFAULT '' NOT NULL,
	`utm_content` text DEFAULT '' NOT NULL,
	`utm_term` text DEFAULT '' NOT NULL,
	`referrer_host` text DEFAULT '' NOT NULL,
	`referral_code` text NOT NULL,
	`referred_by` text,
	`receipt_hash` text NOT NULL,
	`visit_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`consent_version` text NOT NULL,
	`consent_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_email_unique` ON `waitlist_signups` (`email_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_referral_unique` ON `waitlist_signups` (`referral_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_receipt_unique` ON `waitlist_signups` (`receipt_hash`);--> statement-breakpoint
CREATE INDEX `waitlist_city_status` ON `waitlist_signups` (`city_key`,`status`);--> statement-breakpoint
CREATE INDEX `waitlist_created` ON `waitlist_signups` (`created_at`);--> statement-breakpoint
CREATE INDEX `waitlist_referred` ON `waitlist_signups` (`referred_by`);--> statement-breakpoint
CREATE INDEX `waitlist_expiry` ON `waitlist_signups` (`expires_at`);--> statement-breakpoint
CREATE TABLE `waitlist_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`source` text DEFAULT 'Direct' NOT NULL,
	`utm_source` text DEFAULT '' NOT NULL,
	`utm_medium` text DEFAULT '' NOT NULL,
	`utm_campaign` text DEFAULT '' NOT NULL,
	`utm_content` text DEFAULT '' NOT NULL,
	`referral_code` text DEFAULT '' NOT NULL,
	`referrer_host` text DEFAULT '' NOT NULL,
	`converted` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `waitlist_visits_day` ON `waitlist_visits` (`day`);