-- FULL DATABASE SETUP AND SEED SCRIPT
-- For: Faizan Islamic School System
-- Purpose: Fresh testing environment with complete data

-- 1. DROP TABLES IN ORDER (If you want to start completely fresh)
/*
DROP TABLE IF EXISTS Transactions;
DROP TABLE IF EXISTS Fees;
DROP TABLE IF EXISTS FeeSettings;
DROP TABLE IF EXISTS Students;
DROP TABLE IF EXISTS Classes;
DROP TABLE IF EXISTS Campuses;
DROP TABLE IF EXISTS Users;
*/

-- 2. CREATE TABLES

-- Campuses
CREATE TABLE Campuses (
    id NVARCHAR(50) PRIMARY KEY,
    campus_name NVARCHAR(255) NOT NULL,
    city NVARCHAR(100),
    region NVARCHAR(100),
    address NVARCHAR(MAX),
    phone NVARCHAR(50),
    email NVARCHAR(255),
    isActive BIT DEFAULT 1,
    createdOn DATETIME DEFAULT GETDATE()
);

-- Classes
CREATE TABLE Classes (
    id NVARCHAR(50) PRIMARY KEY,
    campus_id NVARCHAR(50) NOT NULL,
    class_name NVARCHAR(255) NOT NULL,
    section_name NVARCHAR(50),
    capacity INT DEFAULT 40,
    shift NVARCHAR(50) DEFAULT 'Morning',
    CONSTRAINT FK_Classes_Campuses FOREIGN KEY (campus_id) REFERENCES Campuses(id)
);

-- Students
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
    CONSTRAINT FK_Students_Campuses FOREIGN KEY (campus_id) REFERENCES Campuses(id),
    CONSTRAINT FK_Students_Classes FOREIGN KEY (class_id) REFERENCES Classes(id)
);

-- Users
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

-- FeeSettings
CREATE TABLE FeeSettings (
    id NVARCHAR(50) PRIMARY KEY,
    class_id NVARCHAR(50) NOT NULL,
    monthly_fee DECIMAL(18, 2) DEFAULT 0,
    admission_fee DECIMAL(18, 2) DEFAULT 0,
    security_fee DECIMAL(18, 2) DEFAULT 0,
    last_updated DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_FeeSettings_Classes FOREIGN KEY (class_id) REFERENCES Classes(id)
);

-- Fees
CREATE TABLE Fees (
    id NVARCHAR(50) PRIMARY KEY,
    student_id NVARCHAR(50) NOT NULL,
    amount DECIMAL(18, 2) NOT NULL,
    month INT NOT NULL, -- 0 for past arrears
    year INT NOT NULL,  -- 0 for past arrears
    status NVARCHAR(20) DEFAULT 'Unpaid',
    fee_type NVARCHAR(50) DEFAULT 'Monthly', -- Monthly, Admission, Security, Arrears
    transaction_ref NVARCHAR(255),
    payment_method NVARCHAR(50),
    payment_date DATETIME,
    due_date DATE,
    created_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT FK_Fees_Students FOREIGN KEY (student_id) REFERENCES Students(id)
);

-- Transactions
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

-- QuickPayConfig
CREATE TABLE QuickPayConfig (
    id NVARCHAR(50) PRIMARY KEY,
    merchant_id NVARCHAR(255) NOT NULL,
    api_key NVARCHAR(MAX) NOT NULL,
    callback_url NVARCHAR(MAX),
    mode NVARCHAR(20) DEFAULT 'Sandbox',
    isEnabled BIT DEFAULT 0,
    last_updated DATETIME DEFAULT GETDATE()
);

-- Attendance
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

-- Expenses
CREATE TABLE Expenses (
    id NVARCHAR(50) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    category NVARCHAR(50) NOT NULL, -- Salary, Utility, Rent, Stationery, Other
    amount DECIMAL(18, 2) NOT NULL,
    date DATE NOT NULL,
    recorded_by NVARCHAR(50),
    description NVARCHAR(MAX),
    campus_id NVARCHAR(50),
    created_at DATETIME DEFAULT GETDATE()
);

-- 3. SEED INITIAL DATA

-- Admin User (Password: admin123)
-- Using the hash provided in your system
INSERT INTO Users (id, fullName, username, email, passwordHash, role, isActive, createdOn)
VALUES (N'1', N'Super Admin', N'admin', N'admin@faizan.com', N'$2a$10$f/Zf9c0c1Z2W3Y4X5V6U7TeGkKqLtNpOvPsQuRtSuTuUvVwWxXyYz', N'Super Admin', 1, GETDATE());

-- Campuses
INSERT INTO Campuses (id, campus_name, city, region, address)
VALUES 
(N'C001', N'Main Campus', N'Karachi', N'Sindh', N'Block 13, Gulshan-e-Iqbal'),
(N'C002', N'Johar Campus', N'Karachi', N'Sindh', N'Block 5, Gulistan-e-Johar');

-- Classes
INSERT INTO Classes (id, campus_id, class_name, section_name)
VALUES 
(N'CL001', N'C001', N'Class 1', N'A'),
(N'CL002', N'C001', N'Class 1', N'B'),
(N'CL003', N'C001', N'Class 2', N'A'),
(N'CL004', N'C002', N'Class 1', N'A');

-- Fee Settings
INSERT INTO FeeSettings (id, class_id, monthly_fee, admission_fee, security_fee)
VALUES 
(N'FS001', N'CL001', 3500, 5000, 2000),
(N'FS002', N'CL002', 3500, 5000, 2000),
(N'FS003', N'CL003', 4000, 6000, 2500),
(N'FS004', N'CL004', 3200, 4500, 1500);

-- Students with Outstanding Fees
INSERT INTO Students (id, campus_id, class_id, admission_no, student_name, father_name, father_mobile, admission_date, status, outstanding_fees)
VALUES 
(N'S001', N'C001', N'CL001', N'ADM-001', N'Ahmad Khan', N'Irfan Khan', N'03001234567', '2024-01-10', N'Active', 10500), -- 3 months arrears
(N'S002', N'C001', N'CL001', N'ADM-002', N'Sara Ali', N'Ali Usman', N'03129876543', '2024-02-15', N'Active', 0),    -- Paid student
(N'S003', N'C001', N'CL002', N'ADM-003', N'Bilal Ahmed', N'Zubair Ahmed', N'03335554443', '2024-03-05', N'Active', 7000),  -- 2 months arrears
(N'S004', N'C002', N'CL004', N'ADM-004', N'Zoya Fatima', N'Kamran Jameel', N'03451112223', '2024-04-12', N'Active', 15000), -- Large arrears
(N'S005', N'C001', N'CL003', N'ADM-005', N'Umar Farooq', N'Farooq Abdullah', N'03012223334', '2024-01-20', N'Active', 12000),
(N'S006', N'C002', N'CL004', N'ADM-006', N'Ayesha Siddiqa', N'Muhammad Sadiq', N'03214445556', '2023-11-15', N'Active', 25000),
(N'S007', N'C001', N'CL002', N'ADM-007', N'Hamza Hussain', N'Hussain Altaf', N'03310009998', '2024-02-10', N'Active', 3500),
(N'S008', N'C002', N'CL004', N'ADM-008', N'Fatima Zehra', N'Syed Ali', N'03448887776', '2024-05-01', N'Active', 0);

-- Arrears Vouchers (Fee Month 0)
INSERT INTO Fees (id, student_id, amount, month, year, status, fee_type, due_date)
VALUES 
(N'V-ARR-001', N'S001', 10500, 0, 0, N'Unpaid', N'Arrears', GETDATE()),
(N'V-ARR-003', N'S003', 7000, 0, 0, N'Unpaid', N'Arrears', GETDATE()),
(N'V-ARR-004', N'S004', 15000, 0, 0, N'Unpaid', N'Arrears', GETDATE()),
(N'V-ARR-005', N'S005', 12000, 0, 0, N'Unpaid', N'Arrears', GETDATE()),
(N'V-ARR-006', N'S006', 25000, 0, 0, N'Unpaid', N'Arrears', GETDATE()),
(N'V-ARR-007', N'S007', 3500, 0, 0, N'Unpaid', N'Arrears', GETDATE());

-- Regular Monthly Vouchers for May 2024
INSERT INTO Fees (id, student_id, amount, month, year, status, fee_type, due_date)
VALUES 
(N'V-MAY-001', N'S001', 3500, 5, 2024, N'Unpaid', N'Monthly', '2024-05-15'),
(N'V-MAY-002', N'S002', 3500, 5, 2024, N'Paid', N'Monthly', '2024-05-15'),
(N'V-MAY-003', N'S003', 3500, 5, 2024, N'Unpaid', N'Monthly', '2024-05-15'),
(N'V-MAY-004', N'S004', 3200, 5, 2024, N'Unpaid', N'Monthly', '2024-05-15'),
(N'V-MAY-005', N'S005', 4000, 5, 2024, N'Unpaid', N'Monthly', '2024-05-15'),
(N'V-MAY-006', N'S006', 3200, 5, 2024, N'Unpaid', N'Monthly', '2024-05-15');

-- Transactions History
INSERT INTO Transactions (id, student_id, voucher_id, amount, status, transaction_date)
VALUES 
(N'TX-001', N'S002', N'V-MAY-002', 3500, N'Success', '2024-05-02 10:30:00'),
(N'TX-002', N'S001', N'V-ARR-001', 5000, N'Failed', '2024-05-05 14:20:00'),
(N'TX-003', N'S003', N'V-ARR-003', 2000, N'Pending', '2024-05-13 09:15:00'),
(N'TX-004', N'S004', N'V-ARR-004', 15000, N'Success', '2024-05-10 11:00:00'),
(N'TX-005', N'S006', N'V-ARR-006', 5000, N'Success', '2024-05-12 16:45:00'),
(N'TX-006', N'S005', N'V-MAY-005', 4000, N'Pending', '2024-05-14 08:30:00');

-- QuickPay Config
INSERT INTO QuickPayConfig (id, merchant_id, api_key, callback_url, mode, isEnabled)
VALUES (N'1', N'QUICKPAY_DEMO', N'DEMO_API_KEY_12345', N'https://school.com/api/quickpay/callback', N'Sandbox', 1);

PRINT 'Database Setup and Seeding Completed Successfully!';
