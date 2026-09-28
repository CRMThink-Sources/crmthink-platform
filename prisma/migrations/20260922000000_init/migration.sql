-- CreateTable
CREATE TABLE `app` (
    `app_code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `logo_url` VARCHAR(500) NULL,
    `install_theme` JSON NULL,
    `bitrix_client_id` VARCHAR(200) NOT NULL,
    `bitrix_client_secret_enc` TEXT NOT NULL,
    `scopes` JSON NOT NULL,
    `installer_url` VARCHAR(500) NULL,
    `webhook_url` VARCHAR(500) NULL,
    `webhook_secret_enc` TEXT NOT NULL,
    `previous_webhook_secret_enc` TEXT NULL,
    `previous_webhook_secret_until` DATETIME(3) NULL,
    `api_key_hash` VARCHAR(128) NOT NULL,
    `previous_api_key_hash` VARCHAR(128) NULL,
    `previous_api_key_until` DATETIME(3) NULL,
    `trial_days` INTEGER NOT NULL DEFAULT 0,
    `trial_on_install` BOOLEAN NOT NULL DEFAULT false,
    `trial_plan_id` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `app_bitrix_client_id_key`(`bitrix_client_id`),
    UNIQUE INDEX `app_api_key_hash_key`(`api_key_hash`),
    UNIQUE INDEX `app_previous_api_key_hash_key`(`previous_api_key_hash`),
    PRIMARY KEY (`app_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_product` (
    `app_code` VARCHAR(100) NOT NULL,
    `product_spa_id` INTEGER NOT NULL,

    INDEX `app_product_product_spa_id_idx`(`product_spa_id`),
    PRIMARY KEY (`app_code`, `product_spa_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `installation` (
    `id` INTEGER NOT NULL,
    `app_code` VARCHAR(100) NOT NULL,
    `member_id` VARCHAR(100) NOT NULL,
    `domain` VARCHAR(255) NOT NULL,
    `status` ENUM('INSTALLING', 'INSTALL_PENDING', 'ACTIVE', 'UNINSTALLED', 'AUTH_ERROR') NOT NULL,
    `spa_item_id` INTEGER NULL,
    `contact` JSON NULL,
    `trial_used` BOOLEAN NOT NULL DEFAULT false,
    `installed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `activated_at` DATETIME(3) NULL,
    `uninstalled_at` DATETIME(3) NULL,
    `ever_activated` BOOLEAN NOT NULL DEFAULT false,
    `pending_reinstall` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `installation_spa_item_id_key`(`spa_item_id`),
    INDEX `installation_status_idx`(`status`),
    UNIQUE INDEX `installation_app_code_member_id_key`(`app_code`, `member_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `credential` (
    `installation_id` INTEGER NOT NULL,
    `access_token_enc` TEXT NOT NULL,
    `refresh_token_enc` TEXT NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `client_endpoint` VARCHAR(255) NULL,
    `refresh_failures` INTEGER NOT NULL DEFAULT 0,
    `last_refresh_error` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `credential_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`installation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `application_token` (
    `installation_id` INTEGER NOT NULL,
    `token_enc` TEXT NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`installation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `install_attempt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `installation_id` INTEGER NOT NULL,
    `step` VARCHAR(50) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `install_attempt_installation_id_created_at_idx`(`installation_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signing_key` (
    `kid` VARCHAR(64) NOT NULL,
    `public_jwk` JSON NOT NULL,
    `private_key_enc` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `activated_at` DATETIME(3) NULL,
    `retired_at` DATETIME(3) NULL,

    PRIMARY KEY (`kid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stripe_event` (
    `event_id` VARCHAR(255) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `app_code` VARCHAR(100) NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,
    `status` VARCHAR(20) NOT NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `payload` JSON NULL,

    INDEX `stripe_event_status_idx`(`status`),
    PRIMARY KEY (`event_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_version` (
    `subscription_spa_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `last_written_marker` VARCHAR(64) NULL,
    `last_snapshot` JSON NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`subscription_spa_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `item_version` (
    `item_spa_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `last_written_marker` VARCHAR(64) NULL,
    `last_snapshot` JSON NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`item_spa_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sweep_run` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(50) NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `fixed` INTEGER NOT NULL DEFAULT 0,
    `errors` INTEGER NOT NULL DEFAULT 0,
    `detail` JSON NULL,

    INDEX `sweep_run_kind_started_at_idx`(`kind`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `period_notice` (
    `subscription_spa_id` INTEGER NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `days_left` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`subscription_spa_id`, `period_end`, `days_left`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `app_code` VARCHAR(100) NOT NULL,
    `installation_id` INTEGER NOT NULL,
    `plan_id` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `checkout_session_id` VARCHAR(255) NOT NULL,
    `charge_id` VARCHAR(255) NULL,
    `payment_intent_id` VARCHAR(255) NULL,
    `amount` INTEGER NULL,
    `amount_refunded` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(30) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_checkout_session_id_key`(`checkout_session_id`),
    UNIQUE INDEX `purchase_charge_id_key`(`charge_id`),
    UNIQUE INDEX `purchase_payment_intent_id_key`(`payment_intent_id`),
    INDEX `purchase_installation_id_idx`(`installation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_event` (
    `event_id` VARCHAR(36) NOT NULL,
    `seq` INTEGER NOT NULL AUTO_INCREMENT,
    `app_code` VARCHAR(100) NOT NULL,
    `type` VARCHAR(60) NOT NULL,
    `installation_id` INTEGER NOT NULL,
    `subscription_id` INTEGER NULL,
    `version` INTEGER NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `dedupe_key` VARCHAR(255) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `window_started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `delivered_at` DATETIME(3) NULL,
    `dead_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `outbox_event_seq_key`(`seq`),
    UNIQUE INDEX `outbox_event_dedupe_key_key`(`dedupe_key`),
    INDEX `outbox_event_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `outbox_event_app_code_installation_id_status_seq_idx`(`app_code`, `installation_id`, `status`, `seq`),
    INDEX `outbox_event_app_code_created_at_idx`(`app_code`, `created_at`),
    PRIMARY KEY (`event_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_delivery` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` VARCHAR(36) NOT NULL,
    `attempt` INTEGER NOT NULL,
    `status_code` INTEGER NULL,
    `error` TEXT NULL,
    `next_attempt_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `event_delivery_event_id_attempt_idx`(`event_id`, `attempt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `app_product` ADD CONSTRAINT `app_product_app_code_fkey` FOREIGN KEY (`app_code`) REFERENCES `app`(`app_code`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installation` ADD CONSTRAINT `installation_app_code_fkey` FOREIGN KEY (`app_code`) REFERENCES `app`(`app_code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `credential` ADD CONSTRAINT `credential_installation_id_fkey` FOREIGN KEY (`installation_id`) REFERENCES `installation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `application_token` ADD CONSTRAINT `application_token_installation_id_fkey` FOREIGN KEY (`installation_id`) REFERENCES `installation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `install_attempt` ADD CONSTRAINT `install_attempt_installation_id_fkey` FOREIGN KEY (`installation_id`) REFERENCES `installation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_delivery` ADD CONSTRAINT `event_delivery_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `outbox_event`(`event_id`) ON DELETE CASCADE ON UPDATE CASCADE;

