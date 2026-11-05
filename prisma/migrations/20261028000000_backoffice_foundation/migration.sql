-- DropIndex
DROP INDEX `purchase_installation_id_idx` ON `purchase`;

-- CreateTable
CREATE TABLE `admin_operator` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `password_hash` VARCHAR(255) NOT NULL,
    `totp_secret_enc` TEXT NOT NULL,
    `last_totp_step` INTEGER NOT NULL DEFAULT 0,
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `failed_logins` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_operator_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_session` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_hash` VARCHAR(64) NOT NULL,
    `operator_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(500) NULL,

    UNIQUE INDEX `admin_session_id_hash_key`(`id_hash`),
    INDEX `admin_session_operator_id_revoked_at_idx`(`operator_id`, `revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_audit_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actor` VARCHAR(100) NOT NULL,
    `actor_role` VARCHAR(20) NULL,
    `action` VARCHAR(200) NOT NULL,
    `target_type` VARCHAR(50) NULL,
    `target_id` VARCHAR(200) NULL,
    `status_code` INTEGER NULL,
    `error_code` VARCHAR(100) NULL,
    `summary` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(500) NULL,
    `request_id` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_audit_log_target_type_target_id_created_at_idx`(`target_type`, `target_id`, `created_at`),
    INDEX `admin_audit_log_actor_created_at_idx`(`actor`, `created_at`),
    INDEX `admin_audit_log_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `installation_installed_at_id_idx` ON `installation`(`installed_at`, `id`);

-- CreateIndex
CREATE INDEX `stripe_event_received_at_event_id_idx` ON `stripe_event`(`received_at`, `event_id`);

-- CreateIndex
CREATE INDEX `purchase_installation_id_created_at_idx` ON `purchase`(`installation_id`, `created_at`);

-- CreateIndex
CREATE INDEX `outbox_event_installation_id_created_at_idx` ON `outbox_event`(`installation_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `admin_session` ADD CONSTRAINT `admin_session_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `admin_operator`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

