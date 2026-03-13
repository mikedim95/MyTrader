CREATE TABLE IF NOT EXISTS miners (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  ip VARCHAR(45) NOT NULL UNIQUE,
  api_base_url VARCHAR(255) NOT NULL,
  password_enc TEXT NOT NULL,
  model VARCHAR(120) NULL,
  firmware VARCHAR(120) NULL,
  current_preset VARCHAR(120) NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  verification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  last_seen_at DATETIME NULL,
  last_error TEXT NULL,
  capabilities_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS miner_status_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  miner_id BIGINT UNSIGNED NOT NULL,
  online BOOLEAN NOT NULL,
  miner_state VARCHAR(30) NULL,
  preset_name VARCHAR(120) NULL,
  preset_pretty VARCHAR(120) NULL,
  preset_status VARCHAR(30) NULL,
  total_rate_ths DECIMAL(12, 2) NULL,
  board_temp_1 INT NULL,
  board_temp_2 INT NULL,
  board_temp_3 INT NULL,
  hotspot_temp_1 INT NULL,
  hotspot_temp_2 INT NULL,
  hotspot_temp_3 INT NULL,
  fan_pwm INT NULL,
  fan_rpm_1 INT NULL,
  fan_rpm_2 INT NULL,
  fan_rpm_3 INT NULL,
  fan_rpm_4 INT NULL,
  power_watts INT NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_miner_status_snapshots_miner_created (miner_id, created_at),
  CONSTRAINT fk_miner_status_snapshots_miner
    FOREIGN KEY (miner_id) REFERENCES miners(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS miner_pools (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  miner_id BIGINT UNSIGNED NOT NULL,
  pool_index INT NOT NULL,
  url VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  status VARCHAR(30) NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_miner_pool_index (miner_id, pool_index),
  CONSTRAINT fk_miner_pools_miner
    FOREIGN KEY (miner_id) REFERENCES miners(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS miner_commands (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  miner_id BIGINT UNSIGNED NOT NULL,
  command_type VARCHAR(50) NOT NULL,
  request_json JSON NULL,
  response_json JSON NULL,
  status VARCHAR(30) NOT NULL,
  error_text TEXT NULL,
  created_by VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_miner_commands_miner
    FOREIGN KEY (miner_id) REFERENCES miners(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;
