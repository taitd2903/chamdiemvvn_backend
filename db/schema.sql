-- MySQL schema tham khảo cho bản production.
-- Backend hiện lưu state realtime vào bảng app_state để chạy ổn ngay; các bảng dưới đây map trực tiếp sang logic production khi tách repository SQL chi tiết.

CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(64) PRIMARY KEY,
  tournament_name VARCHAR(500) NOT NULL,
  logo_left_url VARCHAR(1000) NULL,
  logo_right_url VARCHAR(1000) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS areas (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type ENUM('form', 'fighting') NOT NULL,
  status ENUM('idle', 'form_running', 'fighting_running', 'paused', 'finished', 'locked') NOT NULL DEFAULT 'idle',
  -- judge_count chỉ tính số giám định bấm/nhập điểm, KHÔNG tính tổng trọng tài.
  judge_count INT NOT NULL DEFAULT 5,
  current_form_entry_id VARCHAR(64) NULL,
  current_fight_match_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Các slot dưới đây chỉ dành cho giám định chấm/bấm điểm.
-- Tổng trọng tài là vai trò riêng theo URL /forms/area/:areaId/referee hoặc /fighting/area/:areaId/referee và không nằm trong bảng này.
CREATE TABLE IF NOT EXISTS judge_slots (
  id VARCHAR(64) PRIMARY KEY,
  area_id VARCHAR(64) NOT NULL,
  judge_no INT NOT NULL,
  status ENUM('empty', 'connected', 'disconnected', 'locked') NOT NULL DEFAULT 'empty',
  display_name VARCHAR(255) NULL,
  socket_id VARCHAR(255) NULL,
  connected_at DATETIME NULL,
  UNIQUE KEY uq_area_judge (area_id, judge_no),
  CONSTRAINT fk_judge_slots_area FOREIGN KEY (area_id) REFERENCES areas(id)
);


-- Bảng tùy chọn nếu sau này muốn quản lý tài khoản/link tổng trọng tài riêng cho từng sân Quyền hoặc Đối kháng.
-- Bản hiện tại dùng URL cố định theo areaId, nên tổng trọng tài không chiếm judge_no.
CREATE TABLE IF NOT EXISTS area_referees (
  id VARCHAR(64) PRIMARY KEY,
  area_id VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NOT NULL DEFAULT 'Tổng trọng tài',
  access_token VARCHAR(255) NULL,
  is_fixed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_area_referee (area_id),
  CONSTRAINT fk_area_referee_area FOREIGN KEY (area_id) REFERENCES areas(id)
);

CREATE TABLE IF NOT EXISTS contents (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type ENUM('form', 'fighting') NOT NULL,
  mode ENUM('individual', 'team') NOT NULL DEFAULT 'individual',
  member_count INT NOT NULL DEFAULT 1,
  member_count_max INT NULL,
  form_size VARCHAR(32) NULL,
  age_group_scope ENUM('all', 'specific') NULL,
  registration_limit INT NULL,
  gender VARCHAR(32) NULL,
  age_group VARCHAR(255) NULL,
  birth_year_from INT NULL,
  birth_year_to INT NULL,
  weight_min DECIMAL(8,2) NULL,
  weight_max DECIMAL(8,2) NULL,
  weight_class VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS athletes (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(255) NULL,
  birth_year INT NULL,
  gender VARCHAR(32) NULL,
  weight_kg DECIMAL(8,2) NULL,
  weight_class VARCHAR(255) NULL,
  age_group VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registrations (
  id VARCHAR(64) PRIMARY KEY,
  athlete_id VARCHAR(64) NOT NULL,
  content_id VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reg_athlete FOREIGN KEY (athlete_id) REFERENCES athletes(id),
  CONSTRAINT fk_reg_content FOREIGN KEY (content_id) REFERENCES contents(id)
);

CREATE TABLE IF NOT EXISTS form_entries (
  id VARCHAR(64) PRIMARY KEY,
  content_id VARCHAR(64) NOT NULL,
  area_id VARCHAR(64) NOT NULL,
  athlete_id VARCHAR(64) NULL,
  participant_name VARCHAR(255) NOT NULL,
  participant_unit VARCHAR(255) NULL,
  birth_year INT NULL,
  gender VARCHAR(32) NULL,
  weight_kg DECIMAL(8,2) NULL,
  weight_class VARCHAR(255) NULL,
  age_group VARCHAR(255) NULL,
  order_no INT NOT NULL,
  status ENUM('pending', 'running', 'skipped', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  final_score DECIMAL(8,2) NULL,
  removed_low DECIMAL(8,2) NULL,
  removed_high DECIMAL(8,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_form_entry_content FOREIGN KEY (content_id) REFERENCES contents(id),
  CONSTRAINT fk_form_entry_area FOREIGN KEY (area_id) REFERENCES areas(id)
);

CREATE TABLE IF NOT EXISTS form_scores (
  id VARCHAR(64) PRIMARY KEY,
  form_entry_id VARCHAR(64) NOT NULL,
  judge_no INT NOT NULL,
  score DECIMAL(8,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_form_entry_judge (form_entry_id, judge_no),
  CONSTRAINT fk_form_score_entry FOREIGN KEY (form_entry_id) REFERENCES form_entries(id)
);

CREATE TABLE IF NOT EXISTS fight_matches (
  id VARCHAR(64) PRIMARY KEY,
  content_id VARCHAR(64) NOT NULL,
  area_id VARCHAR(64) NOT NULL,
  order_no INT NOT NULL,
  red_name VARCHAR(255) NOT NULL,
  blue_name VARCHAR(255) NOT NULL,
  red_athlete_id VARCHAR(64) NULL,
  blue_athlete_id VARCHAR(64) NULL,
  red_unit VARCHAR(255) NULL,
  blue_unit VARCHAR(255) NULL,
  red_birth_year INT NULL,
  blue_birth_year INT NULL,
  red_gender VARCHAR(32) NULL,
  blue_gender VARCHAR(32) NULL,
  red_weight_kg DECIMAL(8,2) NULL,
  blue_weight_kg DECIMAL(8,2) NULL,
  red_weight_class VARCHAR(255) NULL,
  blue_weight_class VARCHAR(255) NULL,
  red_age_group VARCHAR(255) NULL,
  blue_age_group VARCHAR(255) NULL,
  status ENUM('pending', 'running', 'paused', 'break', 'golden', 'skipped', 'finished', 'cancelled') NOT NULL DEFAULT 'pending',
  round_no INT NOT NULL DEFAULT 1,
  max_rounds INT NOT NULL DEFAULT 3,
  round_seconds INT NOT NULL DEFAULT 120,
  break_seconds INT NOT NULL DEFAULT 45,
  remaining_seconds INT NOT NULL DEFAULT 120,
  red_score INT NOT NULL DEFAULT 0,
  blue_score INT NOT NULL DEFAULT 0,
  winner ENUM('red', 'blue') NULL,
  win_reason VARCHAR(255) NULL,
  golden_point BOOLEAN NOT NULL DEFAULT FALSE,
  red_fault_reminders INT NOT NULL DEFAULT 0,
  red_medical_reminders INT NOT NULL DEFAULT 0,
  red_warnings INT NOT NULL DEFAULT 0,
  blue_fault_reminders INT NOT NULL DEFAULT 0,
  blue_medical_reminders INT NOT NULL DEFAULT 0,
  blue_warnings INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fight_match_content FOREIGN KEY (content_id) REFERENCES contents(id),
  CONSTRAINT fk_fight_match_area FOREIGN KEY (area_id) REFERENCES areas(id)
);

CREATE TABLE IF NOT EXISTS fight_votes (
  id VARCHAR(64) PRIMARY KEY,
  match_id VARCHAR(64) NOT NULL,
  judge_no INT NOT NULL,
  side ENUM('red', 'blue') NOT NULL,
  points INT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fight_vote_match FOREIGN KEY (match_id) REFERENCES fight_matches(id)
);

CREATE TABLE IF NOT EXISTS fight_score_history (
  id VARCHAR(64) PRIMARY KEY,
  match_id VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL,
  side ENUM('red', 'blue') NULL,
  points INT NULL,
  source VARCHAR(64) NULL,
  label VARCHAR(255) NULL,
  undone BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fight_history_match FOREIGN KEY (match_id) REFERENCES fight_matches(id)
);


-- Bảng app_state dùng cho bản chạy hiện tại: lưu toàn bộ state realtime dạng JSON vào MySQL.
-- Các bảng quan hệ phía trên giữ vai trò schema production/map dữ liệu khi tách repository chi tiết sau này.
CREATE TABLE IF NOT EXISTS app_state (
  id VARCHAR(64) PRIMARY KEY,
  data JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
