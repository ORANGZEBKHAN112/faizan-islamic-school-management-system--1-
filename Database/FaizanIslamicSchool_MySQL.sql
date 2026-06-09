-- MySQL Database Script for Faizan Islamic School ERP
-- Developed by Oranzeb Khan Baloch

CREATE DATABASE IF NOT EXISTS FaizanIslamicSchoolDB;
USE FaizanIslamicSchoolDB;

-- 1. Roles Table
CREATE TABLE Roles (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    Name VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO Roles (Name) VALUES ('Super Admin'), ('Admin'), ('Teacher'), ('Accountant'), ('Student');

-- 2. Campuses Table
CREATE TABLE Campuses (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    CampusCode VARCHAR(20) NOT NULL UNIQUE,
    CampusName VARCHAR(100) NOT NULL,
    Address TEXT,
    Phone VARCHAR(20),
    Email VARCHAR(100),
    IsActive BOOLEAN DEFAULT TRUE,
    CreatedOn DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Users Table
CREATE TABLE Users (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    FullName VARCHAR(100) NOT NULL,
    Username VARCHAR(50) NOT NULL UNIQUE,
    Email VARCHAR(100),
    PasswordHash TEXT NOT NULL,
    RoleId INT NOT NULL,
    CampusId INT,
    IsActive BOOLEAN DEFAULT TRUE,
    CreatedOn DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (RoleId) REFERENCES Roles(Id),
    FOREIGN KEY (CampusId) REFERENCES Campuses(Id)
);

-- 4. Classes Table
CREATE TABLE Classes (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    CampusId INT NOT NULL,
    ClassName VARCHAR(50) NOT NULL,
    SectionName VARCHAR(20),
    Capacity INT,
    Shift VARCHAR(20),
    FOREIGN KEY (CampusId) REFERENCES Campuses(Id)
);

-- 5. Students Table
CREATE TABLE Students (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    CampusId INT NOT NULL,
    ClassId INT NOT NULL,
    RollNumber VARCHAR(50) NOT NULL UNIQUE,
    FirstName VARCHAR(50) NOT NULL,
    LastName VARCHAR(50),
    FatherName VARCHAR(50),
    GuardianName VARCHAR(50),
    GuardianPhone VARCHAR(20),
    DateOfBirth DATE,
    Gender VARCHAR(10),
    Mobile VARCHAR(20),
    Address TEXT,
    AdmissionDate DATE,
    ProfileImage VARCHAR(255),
    Status VARCHAR(20) DEFAULT 'Active',
    OutstandingFees DECIMAL(18, 2) DEFAULT 0.00,
    FOREIGN KEY (CampusId) REFERENCES Campuses(Id),
    FOREIGN KEY (ClassId) REFERENCES Classes(Id)
);

-- 6. Staff Table
CREATE TABLE Staff (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    FullName VARCHAR(100) NOT NULL,
    CNIC VARCHAR(20) NOT NULL UNIQUE,
    Qualification VARCHAR(100),
    Salary DECIMAL(18, 2) NOT NULL,
    JoiningDate DATE,
    CampusId INT NOT NULL,
    RoleId INT NOT NULL,
    Email VARCHAR(100) NOT NULL UNIQUE,
    IsActive BOOLEAN DEFAULT TRUE,
    ProfileImage VARCHAR(255),
    FOREIGN KEY (CampusId) REFERENCES Campuses(Id),
    FOREIGN KEY (RoleId) REFERENCES Roles(Id)
);

-- 7. Fee Structures Table
CREATE TABLE FeeStructures (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    CampusId INT NOT NULL,
    ClassId INT NOT NULL,
    TuitionFee DECIMAL(18, 2) DEFAULT 0,
    AdmissionFee DECIMAL(18, 2) DEFAULT 0,
    ExamFee DECIMAL(18, 2) DEFAULT 0,
    TransportFee DECIMAL(18, 2) DEFAULT 0,
    MiscFee DECIMAL(18, 2) DEFAULT 0,
    FOREIGN KEY (CampusId) REFERENCES Campuses(Id),
    FOREIGN KEY (ClassId) REFERENCES Classes(Id)
);

-- 8. Fee Vouchers Table
CREATE TABLE FeeVouchers (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    StudentId INT NOT NULL,
    CampusId INT NOT NULL,
    VoucherMonth INT NOT NULL,
    VoucherYear INT NOT NULL,
    DueDate DATE NOT NULL,
    TotalAmount DECIMAL(18, 2) NOT NULL,
    PaidAmount DECIMAL(18, 2) DEFAULT 0,
    Status VARCHAR(20) DEFAULT 'Unpaid',
    GeneratedOn DATETIME DEFAULT CURRENT_TIMESTAMP,
    LateFine DECIMAL(18, 2) DEFAULT 0,
    FOREIGN KEY (StudentId) REFERENCES Students(Id),
    FOREIGN KEY (CampusId) REFERENCES Campuses(Id)
);

-- 9. QuickPay Config Table
CREATE TABLE QuickPayConfigs (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    MerchantId VARCHAR(100) NOT NULL,
    ApiKey VARCHAR(255) NOT NULL,
    CallbackUrl VARCHAR(255),
    Mode VARCHAR(20) DEFAULT 'Sandbox',
    IsEnabled BOOLEAN DEFAULT TRUE
);

-- 10. Transactions Table
CREATE TABLE Transactions (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    StudentId INT NOT NULL,
    VoucherId INT NOT NULL,
    Amount DECIMAL(18, 2) NOT NULL,
    Status VARCHAR(20) DEFAULT 'Pending',
    TransactionDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    ResponseLog TEXT,
    FOREIGN KEY (StudentId) REFERENCES Students(Id),
    FOREIGN KEY (VoucherId) REFERENCES FeeVouchers(Id)
);

-- 11. Exam Terms Table
CREATE TABLE ExamTerms (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    TermName VARCHAR(50) NOT NULL,
    CampusId INT NOT NULL,
    Status VARCHAR(20) DEFAULT 'Active',
    FOREIGN KEY (CampusId) REFERENCES Campuses(Id)
);

-- 12. Date Sheets Table
CREATE TABLE DateSheets (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    ExamTermId INT NOT NULL,
    ClassId INT NOT NULL,
    SubjectName VARCHAR(100) NOT NULL,
    ExamDate DATE NOT NULL,
    StartTime TIME,
    EndTime TIME,
    RoomNo VARCHAR(20),
    InvigilatorId INT,
    FOREIGN KEY (ExamTermId) REFERENCES ExamTerms(Id),
    FOREIGN KEY (ClassId) REFERENCES Classes(Id),
    FOREIGN KEY (InvigilatorId) REFERENCES Staff(Id)
);

-- 13. Grade Policies Table
CREATE TABLE GradePolicies (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    MinPercentage DECIMAL(5, 2) NOT NULL,
    MaxPercentage DECIMAL(5, 2) NOT NULL,
    Grade VARCHAR(5) NOT NULL,
    GPA DECIMAL(3, 2) NOT NULL,
    Remarks VARCHAR(100)
);

-- 14. Student Results Table
CREATE TABLE StudentResults (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    ExamTermId INT NOT NULL,
    StudentId INT NOT NULL,
    SubjectName VARCHAR(100) NOT NULL,
    ObtainedMarks DECIMAL(5, 2) NOT NULL,
    TotalMarks DECIMAL(5, 2) NOT NULL,
    Grade VARCHAR(5),
    Remarks TEXT,
    Status VARCHAR(20) DEFAULT 'Present',
    IsDraft BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (ExamTermId) REFERENCES ExamTerms(Id),
    FOREIGN KEY (StudentId) REFERENCES Students(Id)
);

-- Seed Default Admin
-- Password is 'Admin@123' (hashed version would be stored in real app)
INSERT INTO Users (FullName, Username, Email, PasswordHash, RoleId, IsActive) 
VALUES ('Super Admin', 'admin', 'admin@faizanislamic.edu.pk', 'AQAAAAIAAYagAAAAE...hashed...', 1, TRUE);
