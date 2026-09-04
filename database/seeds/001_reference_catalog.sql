BEGIN;

INSERT INTO catalog.manufacturers (id, name, normalized_name, country_code)
VALUES ('10000000-0000-0000-0000-000000000001', 'Saab', 'saab', 'SE')
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO catalog.vehicle_models (id, manufacturer_id, name, normalized_name)
VALUES (
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '9-3', '9-3'
)
ON CONFLICT (manufacturer_id, normalized_name) DO NOTHING;

INSERT INTO catalog.engines (
    id, manufacturer_id, engine_code, normalized_code, display_name,
    fuel_type, displacement_cc, cylinder_count, induction, lifecycle_status
)
VALUES (
    '12000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'B284', 'b284', 'B284 2.8T', 'petrol', 2792, 6, 'turbo', 'candidate'
)
ON CONFLICT (manufacturer_id, normalized_code) DO NOTHING;

INSERT INTO catalog.diagnostic_protocols (
    id, standard_name, transport, addressing, bitrate_kbps, elm_identifier
)
VALUES (
    '13000000-0000-0000-0000-000000000001',
    'ISO 15765-4', 'CAN', '11-bit', 500, '6'
)
ON CONFLICT (standard_name, transport, addressing, bitrate_kbps) DO NOTHING;

INSERT INTO knowledge.sources (
    id, source_type, publisher, title, language_code, trust_tier,
    lifecycle_status, redistribution_allowed, metadata
)
VALUES (
    '14000000-0000-0000-0000-000000000001',
    'observed_session', 'OBD AI Scanner',
    'Reference hardware observation: Saab 9-3 B284 / ELM327',
    'pl', 3, 'candidate', false,
    '{"note":"Observed during local MVP testing; requires authoritative corroboration before publication."}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog.diagnostic_parameters (
    namespace, service_mode, pid_code, canonical_key, display_name_pl,
    display_name_en, unit, decoder_key, formula_text, byte_length,
    sample_priority, safety_class, lifecycle_status
)
VALUES
('obd2_standard','01','04','obd2.engine_load','Obciążenie silnika','Calculated engine load','%','percent_a','A × 100 / 255',1,3,'read_only','verified'),
('obd2_standard','01','05','obd2.coolant_temp','Temperatura płynu chłodzącego','Engine coolant temperature','°C','temperature_a_minus_40','A − 40',1,2,'read_only','verified'),
('obd2_standard','01','06','obd2.stft_b1','STFT Bank 1','Short-term fuel trim bank 1','%','fuel_trim_a','(A − 128) × 100 / 128',1,1,'read_only','verified'),
('obd2_standard','01','07','obd2.ltft_b1','LTFT Bank 1','Long-term fuel trim bank 1','%','fuel_trim_a','(A − 128) × 100 / 128',1,1,'read_only','verified'),
('obd2_standard','01','08','obd2.stft_b2','STFT Bank 2','Short-term fuel trim bank 2','%','fuel_trim_a','(A − 128) × 100 / 128',1,1,'read_only','verified'),
('obd2_standard','01','09','obd2.ltft_b2','LTFT Bank 2','Long-term fuel trim bank 2','%','fuel_trim_a','(A − 128) × 100 / 128',1,1,'read_only','verified'),
('obd2_standard','01','0B','obd2.map','Ciśnienie MAP','Intake manifold absolute pressure','kPa','unsigned_a','A',1,1,'read_only','verified'),
('obd2_standard','01','0C','obd2.rpm','Obroty silnika','Engine speed','rpm','rpm_ab','(256 × A + B) / 4',2,1,'read_only','verified'),
('obd2_standard','01','0D','obd2.speed','Prędkość pojazdu','Vehicle speed','km/h','unsigned_a','A',1,2,'read_only','verified'),
('obd2_standard','01','0E','obd2.timing_advance','Wyprzedzenie zapłonu','Timing advance','°','timing_a','A / 2 − 64',1,3,'read_only','verified'),
('obd2_standard','01','0F','obd2.intake_temp','Temperatura dolotu','Intake air temperature','°C','temperature_a_minus_40','A − 40',1,2,'read_only','verified'),
('obd2_standard','01','10','obd2.maf','Przepływ MAF','Mass air flow','g/s','maf_ab','(256 × A + B) / 100',2,1,'read_only','verified'),
('obd2_standard','01','11','obd2.throttle','Pozycja przepustnicy','Throttle position','%','percent_a','A × 100 / 255',1,2,'read_only','verified'),
('obd2_standard','01','33','obd2.barometric_pressure','Ciśnienie atmosferyczne','Barometric pressure','kPa','unsigned_a','A',1,2,'read_only','verified'),
('obd2_standard','01','42','obd2.module_voltage','Napięcie modułu','Control module voltage','V','voltage_ab','(256 × A + B) / 1000',2,2,'read_only','verified')
ON CONFLICT (canonical_key) DO NOTHING;

COMMIT;
