-- Create vendor balance audit log table
CREATE TABLE IF NOT EXISTS vendor_balance_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  column_name ENUM('total_paid', 'total_allocated', 'total_refunded', 'total_refund_allocated') NOT NULL,
  change_amount DECIMAL(10,2) NOT NULL,
  old_value DECIMAL(10,2) NOT NULL,
  new_value DECIMAL(10,2) NOT NULL,
  source_type ENUM(
    'purchase_create', 'purchase_edit', 'purchase_delete',
    'return_edit', 'return_delete',
    'payment_create', 'payment_edit', 'payment_delete',
    'refund_create', 'refund_edit', 'refund_delete'
  ) NOT NULL,
  source_id INT NOT NULL,
  reference_no VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  notes TEXT,
  FOREIGN KEY (vendor_id) REFERENCES vendor_details(id) ON DELETE CASCADE,
  INDEX idx_vendor_date (vendor_id, created_at DESC),
  INDEX idx_column (column_name),
  INDEX idx_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
