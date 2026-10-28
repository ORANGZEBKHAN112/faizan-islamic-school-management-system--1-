/*
  Wipes campus, class, student, and fee data.
  Keeps Users, Staff, roles, and QuickPayConfig.
  Also removes rows that block those deletes (attendance, exams, admissions, bookstore sales).

  Run against the live database in SSMS or:
    sqlcmd -S HOST -d FaizanIslamicSchool -U sa -P *** -i Database/clean_campus_class_student_fees.sql

  This cannot be undone. Take a backup first.
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('BookRefunds', 'U') IS NOT NULL DELETE FROM BookRefunds;
IF OBJECT_ID('BookReturnItems', 'U') IS NOT NULL DELETE FROM BookReturnItems;
IF OBJECT_ID('BookReturns', 'U') IS NOT NULL DELETE FROM BookReturns;
IF OBJECT_ID('BookSalePayments', 'U') IS NOT NULL DELETE FROM BookSalePayments;
IF OBJECT_ID('BookSaleItems', 'U') IS NOT NULL DELETE FROM BookSaleItems;
IF OBJECT_ID('BookSales', 'U') IS NOT NULL DELETE FROM BookSales;
IF OBJECT_ID('BookStockReservationItems', 'U') IS NOT NULL DELETE FROM BookStockReservationItems;
IF OBJECT_ID('BookStockReservations', 'U') IS NOT NULL DELETE FROM BookStockReservations;

IF OBJECT_ID('ExamSubjectMarks', 'U') IS NOT NULL DELETE FROM ExamSubjectMarks;
IF OBJECT_ID('ExamResults', 'U') IS NOT NULL DELETE FROM ExamResults;
IF OBJECT_ID('ExamAttendance', 'U') IS NOT NULL DELETE FROM ExamAttendance;
IF OBJECT_ID('ExamSubjects', 'U') IS NOT NULL DELETE FROM ExamSubjects;
IF OBJECT_ID('Exams', 'U') IS NOT NULL DELETE FROM Exams;

IF OBJECT_ID('Attendance', 'U') IS NOT NULL DELETE FROM Attendance;
IF OBJECT_ID('KuickpayPaymentLog', 'U') IS NOT NULL DELETE FROM KuickpayPaymentLog;
IF OBJECT_ID('FeeAuditLog', 'U') IS NOT NULL DELETE FROM FeeAuditLog;
IF OBJECT_ID('Transactions', 'U') IS NOT NULL DELETE FROM Transactions;
IF OBJECT_ID('Fees', 'U') IS NOT NULL DELETE FROM Fees;
IF OBJECT_ID('FeeGenerationRuns', 'U') IS NOT NULL DELETE FROM FeeGenerationRuns;
IF OBJECT_ID('FeeSettings', 'U') IS NOT NULL DELETE FROM FeeSettings;
IF OBJECT_ID('FeeStructures', 'U') IS NOT NULL DELETE FROM FeeStructures;

IF OBJECT_ID('AdmissionDocuments', 'U') IS NOT NULL DELETE FROM AdmissionDocuments;
IF OBJECT_ID('AdmissionApplications', 'U') IS NOT NULL DELETE FROM AdmissionApplications;

IF OBJECT_ID('Students', 'U') IS NOT NULL DELETE FROM Students;
IF OBJECT_ID('Classes', 'U') IS NOT NULL DELETE FROM Classes;
IF OBJECT_ID('UserCampuses', 'U') IS NOT NULL DELETE FROM UserCampuses;
IF OBJECT_ID('CampusNameHistory', 'U') IS NOT NULL DELETE FROM CampusNameHistory;
IF OBJECT_ID('Campuses', 'U') IS NOT NULL DELETE FROM Campuses;
IF OBJECT_ID('DashboardCampusStats', 'U') IS NOT NULL DELETE FROM DashboardCampusStats;

COMMIT TRANSACTION;

SELECT 'Campuses' AS tableName, COUNT(*) AS remaining FROM Campuses
UNION ALL SELECT 'Classes', COUNT(*) FROM Classes
UNION ALL SELECT 'Students', COUNT(*) FROM Students
UNION ALL SELECT 'Fees', COUNT(*) FROM Fees;
