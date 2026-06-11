-- Faizan Islamic School Management System
-- SQL Server schema (canonical source of truth for the active Express app).
-- Create the database first, then run this script against it.
-- The server also applies idempotent schema patches on startup (see connectToDb in server.ts).

-- 1. Campuses
CREATE TABLE Campuses (
    id NVARCHAR(50) PRIMARY KEY,
    campus_code NVARCHAR(50),
    campus_name NVARCHAR(255) NOT NULL,
    city NVARCHAR(100),
    region NVARCHAR(100),
    address NVARCHAR(MAX),
    phone NVARCHAR(50),
    email NVARCHAR(255),
    isActive BIT DEFAULT 1,
    createdOn DATETIME DEFAULT GETDATE()
);

-- 2. Classes
CREATE TABLE Classes (
    id NVARCHAR(50) PRIMARY KEY,
    campus_id NVARCHAR(50) NOT NULL,
    class_name NVARCHAR(255) NOT NULL,
    section_name NVARCHAR(50),
    capacity INT DEFAULT 40,
    shift NVARCHAR(50) DEFAULT 'Morning',
    CONSTRAINT FK_Classes_Campuses FOREIGN KEY (campus_id) REFERENCES Campuses(id)
);

-- 3. Students
CREATE TABLE Students (
    id NVARCHAR(50) PRIMARY KEY,
    campus_id NVARCHAR(50) NOT NULL,
    class_id NVARCHAR(50) NOT NULL,
    admission_no NVARCHAR(50) NOT NULL,
    registration_no NVARCHAR(50),
    gr_no NVARCHAR(50),
    student_name NVARCHAR(255) NOT NULL,
    father_name NVARCHAR(255),
    father_cnic NVARCHAR(50),
    father_mobile NVARCHAR(50),
    dob DATE,
    admission_date DATE,
    gender NVARCHAR(20),
    address NVARCHAR(MAX),
    city NVARCHAR(100),
    batch_no NVARCHAR(50),
    status NVARCHAR(20) DEFAULT 'Active',
    outstanding_fees DECIMAL(18, 2) DEFAULT 0,
    profile_image NVARCHAR(MAX),
    CONSTRAINT FK_Students_Campuses FOREIGN KEY (campus_id) REFERENCES Campuses(id),
    CONSTRAINT FK_Students_Classes FOREIGN KEY (class_id) REFERENCES Classes(id)
);

CREATE UNIQUE INDEX UX_Students_admission_no ON Students(admission_no);

-- 4. Users
CREATE TABLE Users (
    id NVARCHAR(50) PRIMARY KEY,
    fullName NVARCHAR(255) NOT NULL,
    username NVARCHAR(255) NOT NULL UNIQUE,
    email NVARCHAR(255),
    passwordHash NVARCHAR(MAX) NOT NULL,
    role NVARCHAR(50) NOT NULL,
    campusId NVARCHAR(50),
    isActive BIT DEFAULT 1,
    createdOn DATETIME DEFAULT GETDATE(),
    uid NVARCHAR(255)
);

-- 5. Staff
CREATE TABLE Staff (
    id NVARCHAR(50) PRIMARY KEY,
    fullName NVARCHAR(255) NOT NULL,
    cnic NVARCHAR(50) NOT NULL,
    qualification NVARCHAR(255),
    salary DECIMAL(18, 2),
    joiningDate DATE,
    campusId NVARCHAR(50) NOT NULL,
    role NVARCHAR(50) NOT NULL,
    email NVARCHAR(255),
    isActive BIT DEFAULT 1,
    profileImage NVARCHAR(MAX),
    CONSTRAINT FK_Staff_Campuses FOREIGN KEY (campusId) REFERENCES Campuses(id)
);

-- 6. Inventory
CREATE TABLE Inventory (
    id NVARCHAR(50) PRIMARY KEY,
    itemName NVARCHAR(255) NOT NULL,
    category NVARCHAR(100),
    quantity INT DEFAULT 0,
    unit NVARCHAR(50),
    minThreshold INT DEFAULT 0,
    lastUpdated DATETIME DEFAULT GETDATE()
);

-- 7. FeeSettings (per-class fee configuration)
CREATE TABLE FeeSettings (
    id NVARCHAR(50) PRIMARY KEY,
    class_id NVARCHAR(50) NOT NULL,
    monthly_fee DECIMAL(18, 2) DEFAULT 0,
    admission_fee DECIMAL(18, 2) DEFAULT 0,
    security_fee DECIMAL(18, 2) DEFAULT 0,
    exam_fee DECIMAL(18, 2) DEFAULT 0,
    transport_fee DECIMAL(18, 2) DEFAULT 0,
    misc_fee DECIMAL(18, 2) DEFAULT 0,
    summer_camp_fee DECIMAL(18, 2) DEFAULT 0,
    id_card_fee DECIMAL(18, 2) DEFAULT 0,
    trip_fee DECIMAL(18, 2) DEFAULT 0,
    last_updated DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_FeeSettings_Classes FOREIGN KEY (class_id) REFERENCES Classes(id)
);

-- 8. FeeStructures (one fee template per campus per academic session)
CREATE TABLE FeeStructures (
    id NVARCHAR(50) PRIMARY KEY,
    campus_id NVARCHAR(50) NOT NULL,
    class_id NVARCHAR(50) NULL,
    session NVARCHAR(20) NULL,
    tuition_fee DECIMAL(18, 2) DEFAULT 0,
    admission_fee DECIMAL(18, 2) DEFAULT 0,
    security_fee DECIMAL(18, 2) DEFAULT 0,
    exam_fee DECIMAL(18, 2) DEFAULT 0,
    transport_fee DECIMAL(18, 2) DEFAULT 0,
    misc_fee DECIMAL(18, 2) DEFAULT 0,
    summer_camp_fee DECIMAL(18, 2) DEFAULT 0,
    id_card_fee DECIMAL(18, 2) DEFAULT 0,
    trip_fee DECIMAL(18, 2) DEFAULT 0,
    last_updated DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_FeeStructures_Campuses FOREIGN KEY (campus_id) REFERENCES Campuses(id)
);
CREATE UNIQUE INDEX UX_FeeStructures_campus_session ON FeeStructures(campus_id, session) WHERE class_id IS NULL;
CREATE UNIQUE INDEX UX_FeeStructures_class_id ON FeeStructures(class_id) WHERE class_id IS NOT NULL;

-- 9. Fees (voucher + payment tracking)
CREATE TABLE Fees (
    id NVARCHAR(50) PRIMARY KEY,
    student_id NVARCHAR(50) NOT NULL,
    amount DECIMAL(18, 2) NOT NULL,
    month INT NOT NULL,            -- 0 for arrears
    year INT NOT NULL,             -- 0 for arrears
    status NVARCHAR(20) DEFAULT 'Unpaid', -- Unpaid, Pending, Partially Paid, Paid, Overdue
    fee_type NVARCHAR(20) DEFAULT 'Monthly', -- Monthly, Admission, Arrears, Fine
    transaction_ref NVARCHAR(255),
    payment_method NVARCHAR(50),
    payment_date DATETIME,
    due_date DATE,
    created_at DATETIME DEFAULT GETDATE(),
    tuition_fee DECIMAL(18, 2) DEFAULT 0,
    admission_fee DECIMAL(18, 2) DEFAULT 0,
    exam_fee DECIMAL(18, 2) DEFAULT 0,
    transport_fee DECIMAL(18, 2) DEFAULT 0,
    misc_fee DECIMAL(18, 2) DEFAULT 0,
    arrears DECIMAL(18, 2) DEFAULT 0,
    paid_amount DECIMAL(18, 2) DEFAULT 0,
    discount_amount DECIMAL(18, 2) DEFAULT 0,
    fine_amount DECIMAL(18, 2) DEFAULT 0,
    balance_amount DECIMAL(18, 2) DEFAULT 0,
    payment_history NVARCHAR(MAX),
    campus_name_snapshot NVARCHAR(200),
    months_label NVARCHAR(100),
    security_fee DECIMAL(18, 2) DEFAULT 0,
    summer_camp_fee DECIMAL(18, 2) DEFAULT 0,
    id_card_fee DECIMAL(18, 2) DEFAULT 0,
    trip_fee DECIMAL(18, 2) DEFAULT 0,
    CONSTRAINT FK_Fees_Students FOREIGN KEY (student_id) REFERENCES Students(id)
);

-- 10. Transactions (payment gateway log)
CREATE TABLE Transactions (
    id NVARCHAR(50) PRIMARY KEY,
    student_id NVARCHAR(50) NOT NULL,
    voucher_id NVARCHAR(50),
    amount DECIMAL(18, 2) NOT NULL,
    status NVARCHAR(20) DEFAULT 'Pending', -- Pending, Success, Failed
    transaction_ref NVARCHAR(255),
    payment_method NVARCHAR(50),
    transaction_date DATETIME DEFAULT GETDATE(),
    response_log NVARCHAR(MAX)
);

-- 11. QuickPayConfig
CREATE TABLE QuickPayConfig (
    id NVARCHAR(50) PRIMARY KEY,
    merchant_id NVARCHAR(255) NOT NULL,
    api_key NVARCHAR(MAX) NOT NULL,
    callback_url NVARCHAR(MAX),
    mode NVARCHAR(20) DEFAULT 'Sandbox',
    isEnabled BIT DEFAULT 0,
    last_updated DATETIME DEFAULT GETDATE()
);

-- 12. Attendance
CREATE TABLE Attendance (
    id NVARCHAR(50) PRIMARY KEY,
    student_id NVARCHAR(50) NOT NULL,
    class_id NVARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    status NVARCHAR(20) NOT NULL, -- Present, Absent, Leave, Late
    remarks NVARCHAR(MAX),
    recorded_by NVARCHAR(50),
    created_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_Attendance_Students FOREIGN KEY (student_id) REFERENCES Students(id),
    CONSTRAINT FK_Attendance_Classes FOREIGN KEY (class_id) REFERENCES Classes(id)
);

-- 13. Expenses
CREATE TABLE Expenses (
    id NVARCHAR(50) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    category NVARCHAR(50) NOT NULL, -- Salaries, Utility Bills, Maintenance, Rent, Miscellaneous
    amount DECIMAL(18, 2) NOT NULL,
    date DATE NOT NULL,
    recorded_by NVARCHAR(50),
    description NVARCHAR(MAX),
    campus_id NVARCHAR(50),
    created_at DATETIME DEFAULT GETDATE()
);

-- 14. AdmissionApplications
CREATE TABLE AdmissionApplications (
    id NVARCHAR(50) PRIMARY KEY,
    campus_id NVARCHAR(50) NOT NULL,
    class_id NVARCHAR(50),
    applicant_name NVARCHAR(255) NOT NULL,
    father_name NVARCHAR(255),
    date_of_birth DATE,
    gender NVARCHAR(20),
    contact_number NVARCHAR(50),
    address NVARCHAR(MAX),
    previous_school NVARCHAR(255),
    applied_on DATETIME DEFAULT GETDATE(),
    status NVARCHAR(30) DEFAULT 'Pending',
    test_marks DECIMAL(18, 2),
    remarks NVARCHAR(MAX),
    reviewed_by NVARCHAR(255),
    reviewed_on DATETIME,
    student_id NVARCHAR(50),
    interview_at DATETIME,
    interview_sms_sent BIT DEFAULT 0,
    interview_sms_sent_on DATETIME,
    CONSTRAINT FK_Admission_Campuses FOREIGN KEY (campus_id) REFERENCES Campuses(id)
);

-- 15. Exams
CREATE TABLE Exams (
    id NVARCHAR(50) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    exam_type NVARCHAR(50) DEFAULT 'Monthly',
    class_id NVARCHAR(50) NOT NULL,
    campus_id NVARCHAR(50) NOT NULL,
    exam_date DATE,
    total_marks DECIMAL(18, 2) DEFAULT 100,
    created_on DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_Exams_Classes FOREIGN KEY (class_id) REFERENCES Classes(id),
    CONSTRAINT FK_Exams_Campuses FOREIGN KEY (campus_id) REFERENCES Campuses(id)
);

-- 15. ExamResults
CREATE TABLE ExamResults (
    id NVARCHAR(50) PRIMARY KEY,
    exam_id NVARCHAR(50) NOT NULL,
    student_id NVARCHAR(50) NOT NULL,
    obtained_marks DECIMAL(18, 2) DEFAULT 0,
    grade NVARCHAR(10),
    remarks NVARCHAR(255),
    recorded_on DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_ExamResults_Exams FOREIGN KEY (exam_id) REFERENCES Exams(id),
    CONSTRAINT FK_ExamResults_Students FOREIGN KEY (student_id) REFERENCES Students(id),
    CONSTRAINT UX_ExamResults_exam_student UNIQUE (exam_id, student_id)
);

-- 16. CampusNameHistory (preserve old campus names in reports after rename)
CREATE TABLE CampusNameHistory (
    id NVARCHAR(50) PRIMARY KEY,
    campus_id NVARCHAR(50) NOT NULL,
    old_name NVARCHAR(200) NOT NULL,
    new_name NVARCHAR(200) NOT NULL,
    changed_on DATETIME DEFAULT GETDATE(),
    changed_by NVARCHAR(100)
);

-- 17. ExamAttendance (exam-day presence for students and staff)
CREATE TABLE ExamAttendance (
    id NVARCHAR(50) PRIMARY KEY,
    exam_id NVARCHAR(50) NOT NULL,
    person_type NVARCHAR(20) NOT NULL,
    person_id NVARCHAR(50) NOT NULL,
    status NVARCHAR(20) NOT NULL,
    recorded_by NVARCHAR(100),
    recorded_on DATETIME DEFAULT GETDATE()
);

-- 18. FeeGenerationRuns (audit log for monthly generation jobs)
CREATE TABLE FeeGenerationRuns (
    id NVARCHAR(50) PRIMARY KEY,
    run_on DATETIME DEFAULT GETDATE(),
    run_by NVARCHAR(255),
    campus_id NVARCHAR(50),
    year INT,
    months_csv NVARCHAR(100),
    processed_count INT DEFAULT 0,
    skipped_missing_fee_settings INT DEFAULT 0,
    new_admissions_count INT DEFAULT 0,
    arrears_count INT DEFAULT 0,
    notes NVARCHAR(MAX)
);

-- 19. Async scaling tables
CREATE TABLE FeeGenerationJobs (
    id NVARCHAR(50) PRIMARY KEY,
    campus_id NVARCHAR(50),
    year INT NOT NULL,
    months_csv NVARCHAR(100) NOT NULL,
    include_admissions BIT DEFAULT 1,
    include_arrears BIT DEFAULT 1,
    status NVARCHAR(20) DEFAULT 'pending',
    processed_count INT DEFAULT 0,
    total_count INT DEFAULT 0,
    skipped_missing_fee_settings INT DEFAULT 0,
    new_admissions_count INT DEFAULT 0,
    arrears_count INT DEFAULT 0,
    error_message NVARCHAR(MAX),
    run_by NVARCHAR(255),
    started_at DATETIME,
    finished_at DATETIME,
    created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE FeeExportJobs (
    id NVARCHAR(50) PRIMARY KEY,
    campus_id NVARCHAR(50),
    year INT,
    month INT,
    status_filter NVARCHAR(30),
    search NVARCHAR(200),
    format NVARCHAR(20) DEFAULT 'csv_zip',
    status NVARCHAR(20) DEFAULT 'pending',
    processed_count INT DEFAULT 0,
    total_count INT DEFAULT 0,
    file_path NVARCHAR(500),
    error_message NVARCHAR(MAX),
    requested_by NVARCHAR(255),
    started_at DATETIME,
    finished_at DATETIME,
    created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE DashboardCampusStats (
    campus_id NVARCHAR(50) NOT NULL PRIMARY KEY,
    active_students INT DEFAULT 0,
    total_collected DECIMAL(18, 2) DEFAULT 0,
    total_outstanding DECIMAL(18, 2) DEFAULT 0,
    defaulters INT DEFAULT 0,
    pending_admissions INT DEFAULT 0,
    exams_scheduled INT DEFAULT 0,
    online_collections DECIMAL(18, 2) DEFAULT 0,
    total_expenses DECIMAL(18, 2) DEFAULT 0,
    refreshed_at DATETIME DEFAULT GETDATE()
);

-- Fee module stability indexes/constraints
CREATE INDEX IX_Fees_student_year_month_status ON Fees(student_id, year, month, status);
CREATE INDEX IX_Fees_year_month_status_campus ON Fees(year, month, status) INCLUDE (student_id, balance_amount, paid_amount);
CREATE INDEX IX_Fees_student_id_created ON Fees(student_id, created_at DESC);
CREATE INDEX IX_Students_campus_class_status ON Students(campus_id, class_id, status);
CREATE UNIQUE INDEX UX_Fees_monthly_admission_student_month_year
ON Fees(student_id, month, year, fee_type)
WHERE fee_type IN ('Monthly', 'Admission');
CREATE UNIQUE INDEX UX_Fees_transaction_ref
ON Fees(transaction_ref)
WHERE transaction_ref IS NOT NULL AND transaction_ref <> '';

-- Note: default admin (username 'admin', password 'admin123') is also seeded on server startup.
-- For a full role seed set, run Database/02_seed_users_roles.sql after schema.
