CREATE TABLE `waitlist_admin_codes` (
	`email_hash` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`encrypted_code` text,
	`nonce` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_by` text,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`delivery_attempts` integer DEFAULT 0 NOT NULL,
	`provider_id` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `waitlist_admin_codes_expiry` ON `waitlist_admin_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `waitlist_admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `waitlist_admin_sessions_expiry` ON `waitlist_admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `waitlist_admin_sessions_owner` ON `waitlist_admin_sessions` (`email_hash`);