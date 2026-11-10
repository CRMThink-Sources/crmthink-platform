-- AlterTable
ALTER TABLE `admin_operator` MODIFY `totp_secret_enc` TEXT NULL;

-- CreateTable
CREATE TABLE `admin_trusted_device` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `id_hash` VARCHAR(64) NOT NULL,
    `operator_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `user_agent` VARCHAR(500) NULL,

    UNIQUE INDEX `admin_trusted_device_id_hash_key`(`id_hash`),
    INDEX `admin_trusted_device_operator_id_revoked_at_idx`(`operator_id`, `revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `admin_trusted_device` ADD CONSTRAINT `admin_trusted_device_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `admin_operator`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
