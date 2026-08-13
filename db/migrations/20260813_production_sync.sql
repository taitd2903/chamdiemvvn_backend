-- Migration an toàn cho database cũ trước khi deploy bản phân quyền/cân/hiệp phụ.
-- Không xóa hoặc ghi đè app_state.

ALTER TABLE users
  MODIFY role ENUM('admin', 'unit_owner', 'weigh_in') NOT NULL;

ALTER TABLE fight_matches
  MODIFY status ENUM('pending', 'running', 'paused', 'break', 'golden', 'decision', 'skipped', 'finished', 'cancelled') NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS app_state (
  id VARCHAR(64) PRIMARY KEY,
  data JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
