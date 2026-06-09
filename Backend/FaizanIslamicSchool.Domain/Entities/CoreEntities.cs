namespace FaizanIslamicSchool.Domain.Entities
{
    public class Student
    {
        public int Id { get; set; }
        public int CampusId { get; set; }
        public int ClassId { get; set; }
        public string RollNumber { get; set; } = string.Empty;
        public string FirstName { get; set; } = string.Empty;
        public string? LastName { get; set; }
        public string? FatherName { get; set; }
        public string? GuardianName { get; set; }
        public string? GuardianPhone { get; set; }
        public DateTime? DateOfBirth { get; set; }
        public string? Gender { get; set; }
        public string? Mobile { get; set; }
        public string? Address { get; set; }
        public DateTime? AdmissionDate { get; set; }
        public string? ProfileImage { get; set; }
        public string Status { get; set; } = "Active";
        public decimal OutstandingFees { get; set; } = 0.00m;
        
        // Navigation properties
        public Campus? Campus { get; set; }
        public Class? Class { get; set; }
    }

    public class Campus
    {
        public int Id { get; set; }
        public string CampusCode { get; set; } = string.Empty;
        public string CampusName { get; set; } = string.Empty;
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedOn { get; set; } = DateTime.Now;
    }

    public class Class
    {
        public int Id { get; set; }
        public int CampusId { get; set; }
        public string ClassName { get; set; } = string.Empty;
        public string? SectionName { get; set; }
        public int? Capacity { get; set; }
        public string? Shift { get; set; }
        
        public Campus? Campus { get; set; }
    }

    public class User
    {
        public int Id { get; set; }
        public string FullName { get; set; } = string.Empty;
        public string Username { get; set; } = string.Empty;
        public string? Email { get; set; }
        public string PasswordHash { get; set; } = string.Empty;
        public int RoleId { get; set; }
        public int? CampusId { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedOn { get; set; } = DateTime.Now;
        
        public Role? Role { get; set; }
        public Campus? Campus { get; set; }
    }

    public class Role
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
    }
}
