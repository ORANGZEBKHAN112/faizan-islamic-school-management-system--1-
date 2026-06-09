-- Faizan Islamic School ERP — one-shot fresh install helper
-- 1) Edit database name below if needed (must match .env SQL_DATABASE)
-- 2) Run this entire script in SSMS
-- 3) Start app: npm run dev
-- 4) Import legacy students via Students → Import Students (.xlsx)

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'FaizanIslamicSchool')
    CREATE DATABASE FaizanIslamicSchool;
GO

USE FaizanIslamicSchool;
GO

-- Drop in dependency order (fresh install only — destroys all data)
IF OBJECT_ID('ExamAttendance', 'U') IS NOT NULL DROP TABLE ExamAttendance;
IF OBJECT_ID('ExamResults', 'U') IS NOT NULL DROP TABLE ExamResults;
IF OBJECT_ID('Exams', 'U') IS NOT NULL DROP TABLE Exams;
IF OBJECT_ID('AdmissionApplications', 'U') IS NOT NULL DROP TABLE AdmissionApplications;
IF OBJECT_ID('Transactions', 'U') IS NOT NULL DROP TABLE Transactions;
IF OBJECT_ID('Fees', 'U') IS NOT NULL DROP TABLE Fees;
IF OBJECT_ID('FeeSettings', 'U') IS NOT NULL DROP TABLE FeeSettings;
IF OBJECT_ID('FeeStructures', 'U') IS NOT NULL DROP TABLE FeeStructures;
IF OBJECT_ID('Attendance', 'U') IS NOT NULL DROP TABLE Attendance;
IF OBJECT_ID('Expenses', 'U') IS NOT NULL DROP TABLE Expenses;
IF OBJECT_ID('Students', 'U') IS NOT NULL DROP TABLE Students;
IF OBJECT_ID('Classes', 'U') IS NOT NULL DROP TABLE Classes;
IF OBJECT_ID('Staff', 'U') IS NOT NULL DROP TABLE Staff;
IF OBJECT_ID('Inventory', 'U') IS NOT NULL DROP TABLE Inventory;
IF OBJECT_ID('CampusNameHistory', 'U') IS NOT NULL DROP TABLE CampusNameHistory;
IF OBJECT_ID('Campuses', 'U') IS NOT NULL DROP TABLE Campuses;
IF OBJECT_ID('QuickPayConfig', 'U') IS NOT NULL DROP TABLE QuickPayConfig;
IF OBJECT_ID('Users', 'U') IS NOT NULL DROP TABLE Users;
GO

PRINT 'Tables dropped. Now run Database/schema.sql, then Database/02_seed_users_roles.sql';
