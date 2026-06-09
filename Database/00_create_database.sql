-- Faizan Islamic School ERP — create empty database
-- Run in SSMS or sqlcmd connected to your SQL Server instance.
-- Adjust the database name to match SQL_DATABASE in your .env file.

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'FaizanIslamicSchool')
BEGIN
    CREATE DATABASE FaizanIslamicSchool;
END
GO

USE FaizanIslamicSchool;
GO

PRINT 'Database ready. Next run: Database/schema.sql then Database/02_seed_users_roles.sql';
