CREATE TABLE `contact_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`request_hash` text NOT NULL,
	`payload_hash` text NOT NULL,
	`encrypted_data` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_request_unique` ON `contact_messages` (`request_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_reference_unique` ON `contact_messages` (`reference`);--> statement-breakpoint
CREATE INDEX `contact_category_status_created` ON `contact_messages` (`category`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_created` ON `contact_messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `contact_expiry` ON `contact_messages` (`expires_at`);