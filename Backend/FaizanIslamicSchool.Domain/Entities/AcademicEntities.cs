using System;
using System.Collections.Generic;

namespace FaizanIslamicSchool.Domain.Entities
{
    public class Staff
    {
        public int Id { get; set; }
        public int? CampusId { get; set; }
        public string FullName { get; set; } = string.Empty;
        public string CNIC { get; set; } = string.Empty;
        public string Qualification { get; set; } = string.Empty;
        public decimal Salary { get; set; }
        public string Role { get; set; } = "Teacher";
        public string Email { get; set; } = string.Empty;
        public bool IsActive { get; set; } = true;
        public DateTime JoiningDate { get; set; }
        
        public Campus? Campus { get; set; }
    }

    public class FeeStructure
    {
        public int Id { get; set; }
        public int CampusId { get; set; }
        public int ClassId { get; set; }
        public decimal TuitionFee { get; set; }
        public decimal TransportFee { get; set; }
        public decimal MiscFee { get; set; }
        
        public Campus? Campus { get; set; }
        public Class? Class { get; set; }
    }

    public class FeeVoucher
    {
        public int Id { get; set; }
        public int StudentId { get; set; }
        public int CampusId { get; set; }
        public int VoucherMonth { get; set; }
        public int VoucherYear { get; set; }
        public DateTime DueDate { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public string Status { get; set; } = "Unpaid";
        public DateTime GeneratedOn { get; set; } = DateTime.Now;
        
        public Student? Student { get; set; }
        public Campus? Campus { get; set; }
    }

    public class QuickPayConfig
    {
        public int Id { get; set; }
        public string MerchantId { get; set; } = string.Empty;
        public string ApiKey { get; set; } = string.Empty;
        public string CallbackUrl { get; set; } = string.Empty;
        public string Mode { get; set; } = "Sandbox";
        public bool IsEnabled { get; set; } = true;
    }

    public class Transaction
    {
        public int Id { get; set; }
        public int StudentId { get; set; }
        public decimal Amount { get; set; }
        public string Status { get; set; } = "Pending";
        public DateTime TransactionDate { get; set; } = DateTime.Now;
        public string? PaymentMethod { get; set; }
        public string? ReferenceNumber { get; set; }
        
        public Student? Student { get; set; }
    }

    public class ExamTerm
    {
        public int Id { get; set; }
        public int CampusId { get; set; }
        public string TermName { get; set; } = string.Empty;
        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }
        public bool IsActive { get; set; } = true;
        
        public Campus? Campus { get; set; }
    }

    public class DateSheet
    {
        public int Id { get; set; }
        public int ExamTermId { get; set; }
        public int ClassId { get; set; }
        public string SubjectName { get; set; } = string.Empty;
        public DateTime ExamDate { get; set; }
        public string? TimeSlot { get; set; }
        
        public ExamTerm? ExamTerm { get; set; }
        public Class? Class { get; set; }
    }

    public class GradePolicy
    {
        public int Id { get; set; }
        public string Grade { get; set; } = string.Empty;
        public int MinPercentage { get; set; }
        public int MaxPercentage { get; set; }
        public string? Remarks { get; set; }
    }

    public class StudentResult
    {
        public int Id { get; set; }
        public int StudentId { get; set; }
        public int ExamTermId { get; set; }
        public string SubjectName { get; set; } = string.Empty;
        public int TotalMarks { get; set; }
        public int ObtainedMarks { get; set; }
        public string? Remarks { get; set; }
        
        public Student? Student { get; set; }
        public ExamTerm? ExamTerm { get; set; }
    }
}
