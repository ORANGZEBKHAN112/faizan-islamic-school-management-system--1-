/*
  Wipe all data EXCEPT Users, AppRoles, AppRolePermissions.
  Run on VPS against Docker SQL (FaizanIslamicSchool).

  Usage on VPS:
    cd /var/www/fiss-erp
    cat Database/wipe_except_users_roles.sql | docker exec -i fiss-sql \
      /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'FaizanSql@2026!' -C -d FaizanIslamicSchool
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;

PRINT 'Starting wipe — keeping Users, AppRoles, AppRolePermissions';

BEGIN TRANSACTION;

DECLARE @sql NVARCHAR(MAX) = N'';

-- Disable all FK constraints
SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' NOCHECK CONSTRAINT ALL;' + CHAR(10)
FROM sys.tables t
WHERE t.is_ms_shipped = 0
  AND SCHEMA_NAME(t.schema_id) = 'dbo';

EXEC sp_executesql @sql;

SET @sql = N'';

-- Delete from every user table except keep-list
SELECT @sql = @sql + N'DELETE FROM ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) + N';' + CHAR(10)
FROM sys.tables t
WHERE t.is_ms_shipped = 0
  AND SCHEMA_NAME(t.schema_id) = 'dbo'
  AND t.name NOT IN (N'Users', N'AppRoles', N'AppRolePermissions');

EXEC sp_executesql @sql;

SET @sql = N'';

-- Re-enable FK constraints
SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' WITH CHECK CHECK CONSTRAINT ALL;' + CHAR(10)
FROM sys.tables t
WHERE t.is_ms_shipped = 0
  AND SCHEMA_NAME(t.schema_id) = 'dbo';

EXEC sp_executesql @sql;

COMMIT TRANSACTION;

PRINT 'Wipe complete.';
PRINT 'Remaining counts:';

IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL
  SELECT 'Users' AS tbl, COUNT(1) AS n FROM dbo.Users;
IF OBJECT_ID('dbo.AppRoles', 'U') IS NOT NULL
  SELECT 'AppRoles' AS tbl, COUNT(1) AS n FROM dbo.AppRoles;
IF OBJECT_ID('dbo.AppRolePermissions', 'U') IS NOT NULL
  SELECT 'AppRolePermissions' AS tbl, COUNT(1) AS n FROM dbo.AppRolePermissions;
