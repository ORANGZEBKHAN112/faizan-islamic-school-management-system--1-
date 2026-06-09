using Microsoft.EntityFrameworkCore;
using FaizanIslamicSchool.Domain.Entities;
using FaizanIslamicSchool.Application.Interfaces;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Linq;

namespace FaizanIslamicSchool.Infrastructure.Persistence
{
    public class ApplicationDbContext : DbContext
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

        public DbSet<User> Users { get; set; }
        public DbSet<Role> Roles { get; set; }
        public DbSet<Campus> Campuses { get; set; }
        public DbSet<Class> Classes { get; set; }
        public DbSet<Student> Students { get; set; }
        public DbSet<Staff> Staff { get; set; }
        public DbSet<FeeStructure> FeeStructures { get; set; }
        public DbSet<FeeVoucher> FeeVouchers { get; set; }
        public DbSet<QuickPayConfig> QuickPayConfigs { get; set; }
        public DbSet<Transaction> Transactions { get; set; }
        public DbSet<ExamTerm> ExamTerms { get; set; }
        public DbSet<DateSheet> DateSheets { get; set; }
        public DbSet<GradePolicy> GradePolicies { get; set; }
        public DbSet<StudentResult> StudentResults { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            // Configure relationships and constraints here
        }
    }

    public class StudentRepository : IStudentRepository
    {
        private readonly ApplicationDbContext _context;

        public StudentRepository(ApplicationDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Student>> GetAllAsync()
        {
            return await _context.Students.Include(s => s.Campus).Include(s => s.Class).ToListAsync();
        }

        public async Task<Student?> GetByIdAsync(int id)
        {
            return await _context.Students.Include(s => s.Campus).Include(s => s.Class).FirstOrDefaultAsync(s => s.Id == id);
        }

        public async Task<Student> AddAsync(Student student)
        {
            _context.Students.Add(student);
            await _context.SaveChangesAsync();
            return student;
        }

        public async Task<bool> UpdateAsync(Student student)
        {
            _context.Students.Update(student);
            return await _context.SaveChangesAsync() > 0;
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var student = await _context.Students.FindAsync(id);
            if (student == null) return false;
            _context.Students.Remove(student);
            return await _context.SaveChangesAsync() > 0;
        }
    }

    public class CampusRepository : ICampusRepository
    {
        private readonly ApplicationDbContext _context;

        public CampusRepository(ApplicationDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Campus>> GetAllAsync()
        {
            return await _context.Campuses.ToListAsync();
        }

        public async Task<Campus?> GetByIdAsync(int id)
        {
            return await _context.Campuses.FindAsync(id);
        }

        public async Task<Campus> AddAsync(Campus campus)
        {
            _context.Campuses.Add(campus);
            await _context.SaveChangesAsync();
            return campus;
        }

        public async Task<bool> UpdateAsync(Campus campus)
        {
            _context.Campuses.Update(campus);
            return await _context.SaveChangesAsync() > 0;
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var campus = await _context.Campuses.FindAsync(id);
            if (campus == null) return false;
            _context.Campuses.Remove(campus);
            return await _context.SaveChangesAsync() > 0;
        }
    }

    public class ClassRepository : IClassRepository
    {
        private readonly ApplicationDbContext _context;

        public ClassRepository(ApplicationDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Class>> GetByCampusIdAsync(int campusId)
        {
            return await _context.Classes.Where(c => c.CampusId == campusId).ToListAsync();
        }

        public async Task<Class?> GetByIdAsync(int id)
        {
            return await _context.Classes.FindAsync(id);
        }

        public async Task<Class> AddAsync(Class cls)
        {
            _context.Classes.Add(cls);
            await _context.SaveChangesAsync();
            return cls;
        }

        public async Task<bool> UpdateAsync(Class cls)
        {
            _context.Classes.Update(cls);
            return await _context.SaveChangesAsync() > 0;
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var cls = await _context.Classes.FindAsync(id);
            if (cls == null) return false;
            _context.Classes.Remove(cls);
            return await _context.SaveChangesAsync() > 0;
        }
    }
}
