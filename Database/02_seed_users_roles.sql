-- Faizan Islamic School ERP — default users and roles
-- Run AFTER Database/schema.sql on a fresh database.
-- Passwords (change in production):
--   admin          / admin123       (Super Admin)
--   superadmin     / superadmin123  (Super Admin)
--   accountant     / accountant123  (Accountant)
--   teacher        / teacher123     (Teacher)
--   campusadmin    / campusadmin123 (Admin)

USE FaizanIslamicSchool;
GO

-- bcrypt hashes (cost 10) — generated with bcryptjs
DECLARE @adminHash NVARCHAR(MAX) = N'$2b$10$qmnng3ZuSBa0wn3w4Mri3e1UJ5lBD9gFvnV9vx9FxqY2P6t6IXVM.';
DECLARE @accountantHash NVARCHAR(MAX) = N'$2b$10$zyrjy4PLG7rsZDHHDBC.bOWPQnuzWyr6dpFDtRJH/5/JDICUIb.kK';
DECLARE @teacherHash NVARCHAR(MAX) = N'$2b$10$R/Cc0LGXLNMXeiyzTpcxKOgjqkqCr.KyBzVxr8U3pTzzguHqO8tdm';
DECLARE @superHash NVARCHAR(MAX) = N'$2b$10$lDEDiKe9Vx.XkwKw9SM6KukfugG5ug2HZ2oqYBNA1nET/VMLj.KT.';
DECLARE @campusAdminHash NVARCHAR(MAX) = N'$2b$10$IBOpYKfrs3sGORpDxV3GJ.6xTcg4z/8nBNkNzqjsmq0QynoYFcJZO';

MERGE Users AS target
USING (VALUES
  (N'usr-super-admin', N'Super Admin', N'admin', N'admin@faizan.com', @adminHash, N'Super Admin', NULL),
  (N'usr-super-2', N'System Super Admin', N'superadmin', N'superadmin@faizan.com', @superHash, N'Super Admin', NULL),
  (N'usr-accountant', N'Head Accountant', N'accountant', N'accountant@faizan.com', @accountantHash, N'Accountant', NULL),
  (N'usr-teacher', N'Demo Teacher', N'teacher', N'teacher@faizan.com', @teacherHash, N'Teacher', NULL),
  (N'usr-campus-admin', N'Campus Administrator', N'campusadmin', N'campusadmin@faizan.com', @campusAdminHash, N'Admin', NULL)
) AS source (id, fullName, username, email, passwordHash, role, campusId)
ON target.username = source.username
WHEN NOT MATCHED THEN
  INSERT (id, fullName, username, email, passwordHash, role, campusId, isActive, createdOn)
  VALUES (source.id, source.fullName, source.username, source.email, source.passwordHash, source.role, source.campusId, 1, GETDATE());

-- QuickPay sandbox config (optional)
IF NOT EXISTS (SELECT 1 FROM QuickPayConfig)
BEGIN
  INSERT INTO QuickPayConfig (id, merchant_id, api_key, callback_url, mode, isEnabled)
  VALUES (
    N'qp-1',
    N'QUICKPAY_DEMO',
    N'DEMO_API_KEY_CHANGE_ME',
    N'http://localhost:3000/api/payments/quickpay-callback',
    N'Sandbox',
    0
  );
END
GO

PRINT 'Users seeded. Login with admin / admin123 (or see passwords in script header).';
