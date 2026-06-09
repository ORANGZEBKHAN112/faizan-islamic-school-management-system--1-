using System.Collections.Generic;
using System.Threading.Tasks;

namespace FaizanIslamicSchool.Application.Interfaces
{
    public interface IStudentService
    {
        Task<IEnumerable<StudentDto>> GetAllStudentsAsync();
        Task<StudentDto?> GetStudentByIdAsync(int id);
        Task<StudentDto> AddStudentAsync(CreateStudentDto studentDto);
        Task<bool> UpdateStudentAsync(int id, UpdateStudentDto studentDto);
        Task<bool> DeleteStudentAsync(int id);
        Task<IEnumerable<StudentDto>> GetDefaultersAsync();
    }

    public interface IFeeService
    {
        Task<IEnumerable<FeeVoucherDto>> GetVouchersByStudentIdAsync(int studentId);
        Task<bool> GenerateVouchersForMonthAsync(int month, int year, int? campusId = null);
        Task<FeeVoucherDto> GenerateSingleVoucherAsync(int studentId, int month, int year);
        Task<bool> ProcessQuickPayCallbackAsync(QuickPayCallbackDto callbackDto);
    }

    public interface IExamService
    {
        Task<IEnumerable<ExamTermDto>> GetExamTermsAsync(int campusId);
        Task<bool> AddMarksAsync(IEnumerable<StudentMarksDto> marksDto);
        Task<ResultCardDto> GetResultCardAsync(int studentId, int examTermId);
    }

    public interface ICampusService
    {
        Task<IEnumerable<CampusDto>> GetAllCampusesAsync();
        Task<CampusDto?> GetCampusByIdAsync(int id);
        Task<CampusDto> AddCampusAsync(CreateCampusDto campusDto);
        Task<bool> UpdateCampusAsync(int id, UpdateCampusDto campusDto);
        Task<bool> DeleteCampusAsync(int id);
    }

    public interface IClassService
    {
        Task<IEnumerable<ClassDto>> GetClassesByCampusIdAsync(int campusId);
        Task<ClassDto?> GetClassByIdAsync(int id);
        Task<ClassDto> AddClassAsync(CreateClassDto classDto);
        Task<bool> UpdateClassAsync(int id, UpdateClassDto classDto);
        Task<bool> DeleteClassAsync(int id);
    }

    public interface IAuthService
    {
        Task<AuthResponseDto?> LoginAsync(LoginRequestDto loginDto);
        Task<AuthResponseDto> RegisterAsync(RegisterRequestDto registerDto);
        Task<UserDto?> GetCurrentUserAsync(string username);
    }

    public interface IStaffService
    {
        Task<IEnumerable<StaffDto>> GetAllStaffAsync();
        Task<StaffDto?> GetStaffByIdAsync(int id);
        Task<StaffDto> AddStaffAsync(CreateStaffDto staffDto);
        Task<bool> UpdateStaffAsync(int id, UpdateStaffDto staffDto);
        Task<bool> DeleteStaffAsync(int id);
    }
}

namespace FaizanIslamicSchool.Application.DTOs
{
    public class UserDto
    {
        public int Id { get; set; }
        public string FullName { get; set; } = string.Empty;
        public string Username { get; set; } = string.Empty;
        public string? Email { get; set; }
        public string RoleName { get; set; } = string.Empty;
        public int? CampusId { get; set; }
    }

    public class LoginRequestDto
    {
        public string Username { get; set; } = string.Empty;
        public string PasswordHash { get; set; } = string.Empty;
    }

    public class RegisterRequestDto
    {
        public string FullName { get; set; } = string.Empty;
        public string Username { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string RoleName { get; set; } = "Student";
        public int? CampusId { get; set; }
    }

    public class AuthResponseDto
    {
        public string Token { get; set; } = string.Empty;
        public UserDto User { get; set; } = new();
    }

    public class StaffDto
    {
        public int Id { get; set; }
        public string FullName { get; set; } = string.Empty;
        public string CNIC { get; set; } = string.Empty;
        public string Qualification { get; set; } = string.Empty;
        public decimal Salary { get; set; }
        public string RoleName { get; set; } = string.Empty;
        public string CampusName { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public bool IsActive { get; set; }
    }

    public class CreateStaffDto
    {
        public string FullName { get; set; } = string.Empty;
        public string CNIC { get; set; } = string.Empty;
        public string Qualification { get; set; } = string.Empty;
        public decimal Salary { get; set; }
        public string RoleName { get; set; } = "Teacher";
        public int CampusId { get; set; }
        public string Email { get; set; } = string.Empty;
        public string Password { get; set; } = "123456";
    }

    public class UpdateStaffDto : CreateStaffDto { }

    public class StudentDto
    {
        public int Id { get; set; }
        public string RollNumber { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public string ClassName { get; set; } = string.Empty;
        public string CampusName { get; set; } = string.Empty;
        public decimal OutstandingFees { get; set; }
        public string Status { get; set; } = "Active";
    }

    public class CreateStudentDto
    {
        public int CampusId { get; set; }
        public int ClassId { get; set; }
        public string FirstName { get; set; } = string.Empty;
        public string? LastName { get; set; }
        public string? FatherName { get; set; }
        public string? GuardianName { get; set; }
        public string? GuardianPhone { get; set; }
        public DateTime? DateOfBirth { get; set; }
        public string? Gender { get; set; }
        public string? Mobile { get; set; }
        public string? Address { get; set; }
        public decimal? OutstandingFees { get; set; }
    }

    public class UpdateStudentDto : CreateStudentDto { }

    public class FeeVoucherDto
    {
        public int Id { get; set; }
        public string RollNumber { get; set; } = string.Empty;
        public string StudentName { get; set; } = string.Empty;
        public int Month { get; set; }
        public int Year { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public string Status { get; set; } = "Unpaid";
        public DateTime DueDate { get; set; }
    }

    public class QuickPayCallbackDto
    {
        public string TransactionId { get; set; } = string.Empty;
        public string OrderId { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public string Status { get; set; } = string.Empty;
        public string Signature { get; set; } = string.Empty;
    }

    public class CampusDto
    {
        public int Id { get; set; }
        public string CampusCode { get; set; } = string.Empty;
        public string CampusName { get; set; } = string.Empty;
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public bool IsActive { get; set; }
    }

    public class CreateCampusDto
    {
        public string CampusCode { get; set; } = string.Empty;
        public string CampusName { get; set; } = string.Empty;
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
    }

    public class UpdateCampusDto : CreateCampusDto { }

    public class ClassDto
    {
        public int Id { get; set; }
        public int CampusId { get; set; }
        public string ClassName { get; set; } = string.Empty;
        public string? SectionName { get; set; }
        public int? Capacity { get; set; }
        public string? Shift { get; set; }
    }

    public class CreateClassDto
    {
        public int CampusId { get; set; }
        public string ClassName { get; set; } = string.Empty;
        public string? SectionName { get; set; }
        public int? Capacity { get; set; }
        public string? Shift { get; set; }
    }

    public class UpdateClassDto : CreateClassDto { }

    public class ExamTermDto
    {
        public int Id { get; set; }
        public string TermName { get; set; } = string.Empty;
        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }
        public bool IsActive { get; set; }
    }

    public class StudentMarksDto
    {
        public int StudentId { get; set; }
        public int ExamTermId { get; set; }
        public string SubjectName { get; set; } = string.Empty;
        public int TotalMarks { get; set; }
        public int ObtainedMarks { get; set; }
    }

    public class ResultCardDto
    {
        public string StudentName { get; set; } = string.Empty;
        public string RollNumber { get; set; } = string.Empty;
        public string ClassName { get; set; } = string.Empty;
        public string TermName { get; set; } = string.Empty;
        public List<SubjectResultDto> Results { get; set; } = new();
        public int TotalMarks { get; set; }
        public int TotalObtained { get; set; }
        public double Percentage { get; set; }
        public string Grade { get; set; } = string.Empty;
    }

    public class SubjectResultDto
    {
        public string Subject { get; set; } = string.Empty;
        public int Total { get; set; }
        public int Obtained { get; set; }
        public string Grade { get; set; } = string.Empty;
    }
}
