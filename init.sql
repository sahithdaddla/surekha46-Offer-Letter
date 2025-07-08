CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    referral_id VARCHAR(50) NOT NULL,
    role TEXT NOT NULL,
    position TEXT NOT NULL,
    location TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    guardian_name TEXT NOT NULL,
    guardian_phone TEXT NOT NULL,
    address TEXT NOT NULL,
    status TEXT NOT NULL,
    submission_date TIMESTAMP,
    approval_date TIMESTAMP,
    rejection_date TIMESTAMP,
    rejection_reason TEXT
);

CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    document_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_data TEXT NOT NULL,
    upload_date TIMESTAMP,
    UNIQUE (employee_id, document_type)
);

CREATE TABLE previous_employment (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    experience TEXT,
    relieving_letter_name TEXT,
    relieving_letter_type TEXT,
    relieving_letter_data TEXT,
    relieving_letter_upload_date TIMESTAMP
);

CREATE TABLE offer_letters (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_data TEXT NOT NULL,
    upload_date TIMESTAMP,
    UNIQUE (employee_id)
);