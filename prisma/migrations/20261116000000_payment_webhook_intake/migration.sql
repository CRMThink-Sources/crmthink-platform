-- CreateTable
CREATE TABLE `payment_integration` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `key_hash` VARCHAR(128) NOT NULL,
    `key_prefix` VARCHAR(16) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_integration_key_hash_key`(`key_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_notice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `integration_id` INTEGER NOT NULL,
    `external_id` VARCHAR(200) NOT NULL,
    `subscription_spa_id` INTEGER NOT NULL,
    `installation_id` INTEGER NOT NULL,
    `period_start` DATETIME(3) NOT NULL,
    `period_end` DATETIME(3) NOT NULL,
    `paid_at` DATETIME(3) NULL,
    `status` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `applied_at` DATETIME(3) NULL,

    INDEX `payment_notice_subscription_spa_id_idx`(`subscription_spa_id`),
    UNIQUE INDEX `payment_notice_integration_id_external_id_key`(`integration_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payment_notice` ADD CONSTRAINT `payment_notice_integration_id_fkey` FOREIGN KEY (`integration_id`) REFERENCES `payment_integration`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

