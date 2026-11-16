-- CreateTable
CREATE TABLE `webhook_endpoint` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `secret_enc` TEXT NOT NULL,
    `previous_secret_enc` TEXT NULL,
    `previous_secret_until` DATETIME(3) NULL,
    `event_types` JSON NOT NULL,
    `app_codes` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_delivery` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `endpoint_id` INTEGER NOT NULL,
    `event_id` VARCHAR(36) NOT NULL,
    `event_seq` INTEGER NOT NULL,
    `installation_id` INTEGER NOT NULL,
    `app_code` VARCHAR(100) NOT NULL,
    `event_type` VARCHAR(60) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `window_started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `delivered_at` DATETIME(3) NULL,
    `dead_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webhook_delivery_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `webhook_delivery_endpoint_id_status_id_idx`(`endpoint_id`, `status`, `id`),
    INDEX `wd_endpoint_installation_status_seq_idx`(`endpoint_id`, `installation_id`, `status`, `event_seq`),
    UNIQUE INDEX `webhook_delivery_endpoint_id_event_id_key`(`endpoint_id`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_delivery_attempt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `delivery_id` INTEGER NOT NULL,
    `attempt` INTEGER NOT NULL,
    `status_code` INTEGER NULL,
    `error` TEXT NULL,
    `next_attempt_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webhook_delivery_attempt_delivery_id_attempt_idx`(`delivery_id`, `attempt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `webhook_delivery` ADD CONSTRAINT `webhook_delivery_endpoint_id_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoint`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_delivery` ADD CONSTRAINT `webhook_delivery_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `outbox_event`(`event_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_delivery_attempt` ADD CONSTRAINT `webhook_delivery_attempt_delivery_id_fkey` FOREIGN KEY (`delivery_id`) REFERENCES `webhook_delivery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

