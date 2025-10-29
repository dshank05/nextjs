-- Add return_status column to invoice table (for sale returns)
-- 0 = No returns, 1 = Partial return, 2 = Full return
ALTER TABLE `invoice` ADD COLUMN `return_status` INT DEFAULT 0 COMMENT '0=none, 1=partial, 2=full';

-- Add return_status column to invoicex table (for salex returns)
-- 0 = No returns, 1 = Partial return, 2 = Full return
ALTER TABLE `invoicex` ADD COLUMN `return_status` INT DEFAULT 0 COMMENT '0=none, 1=partial, 2=full';

-- Add index for better query performance on return_status
ALTER TABLE `invoice` ADD INDEX `idx_invoice_return_status` (`return_status`);
ALTER TABLE `invoicex` ADD INDEX `idx_invoicex_return_status` (`return_status`);

-- Verify the changes
SELECT 'invoice table updated' as status;
DESCRIBE `invoice`;

SELECT 'invoicex table updated' as status;
DESCRIBE `invoicex`;
