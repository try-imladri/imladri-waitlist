ALTER TABLE `waitlist_campaigns` ADD `queue_cursor` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `waitlist_campaigns` ADD `queue_complete` integer DEFAULT 0 NOT NULL;