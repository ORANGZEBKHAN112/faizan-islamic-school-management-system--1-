-- SQL Script for testdb12 - Smart Excel Import Schema
-- USE testdb12;
-- GO

-- Drop existing tables if they exist to ensure fresh start with requested schema
IF OBJECT_ID('Students', 'U') IS NOT NULL DROP TABLE Students;
IF OBJECT_ID('Classes', 'U') IS NOT NULL DROP TABLE Classes;
IF OBJECT_ID('Campuses', 'U') IS NOT NULL DROP TABLE Campuses;

-- 1. Campuses Table
CREATE TABLE Campuses (
    id NVARCHAR(50) PRIMARY KEY,
    campus_name NVARCHAR(255) NOT NULL,
    address NVARCHAR(MAX),
    city NVARCHAR(100),
    region NVARCHAR(100),
    state NVARCHAR(100)
);

-- 2. Classes Table
CREATE TABLE Classes (
    id NVARCHAR(50) PRIMARY KEY,
    campus_id NVARCHAR(50) NOT NULL,
    class_name NVARCHAR(255) NOT NULL,
    section_name NVARCHAR(50),
    CONSTRAINT FK_Classes_Campuses_New FOREIGN KEY (campus_id) REFERENCES Campuses(id)
);

-- 3. Students Table
CREATE TABLE Students (
    id NVARCHAR(50) PRIMARY KEY,
    admission_no NVARCHAR(50),
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
    campus_id NVARCHAR(50) NOT NULL,
    class_id NVARCHAR(50) NOT NULL,
    batch_no NVARCHAR(50),
    status NVARCHAR(50) DEFAULT 'Active',
    CONSTRAINT FK_Students_Campuses_New FOREIGN KEY (campus_id) REFERENCES Campuses(id),
    CONSTRAINT FK_Students_Classes_New FOREIGN KEY (class_id) REFERENCES Classes(id)
);
