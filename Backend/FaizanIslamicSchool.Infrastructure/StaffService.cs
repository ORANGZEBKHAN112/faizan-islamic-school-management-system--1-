using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using FaizanIslamicSchool.Application.Interfaces;
using FaizanIslamicSchool.Application.DTOs;
using FaizanIslamicSchool.Domain.Entities;
using FaizanIslamicSchool.Infrastructure.Persistence;

namespace FaizanIslamicSchool.Infrastructure.Services
{
    public class StaffService : IStaffService
    {
        private readonly ApplicationDbContext _context;
        private readonly IAuthService _authService;

        public StaffService(ApplicationDbContext context, IAuthService authService)
        {
            _context = context;
            _authService = authService;
        }

        public async Task<IEnumerable<StaffDto>> GetAllStaffAsync()
        {
            return await _context.Staff
                .Include(s => s.Campus)
                .Select(s => new StaffDto
                {
                    Id = s.Id,
                    FullName = s.FullName,
                    CNIC = s.CNIC,
                    Qualification = s.Qualification,
                    Salary = s.Salary,
                    RoleName = s.Role,
                    CampusName = s.Campus != null ? s.Campus.CampusName : "N/A",
                    Email = s.Email,
                    IsActive = s.IsActive
                }).ToListAsync();
        }

        public async Task<StaffDto?> GetStaffByIdAsync(int id)
        {
            var s = await _context.Staff
                .Include(s => s.Campus)
                .FirstOrDefaultAsync(x => x.Id == id);

            if (s == null) return null;

            return new StaffDto
            {
                Id = s.Id,
                FullName = s.FullName,
                CNIC = s.CNIC,
                Qualification = s.Qualification,
                Salary = s.Salary,
                RoleName = s.Role,
                CampusName = s.Campus != null ? s.Campus.CampusName : "N/A",
                Email = s.Email,
                IsActive = s.IsActive
            };
        }

        public async Task<StaffDto> AddStaffAsync(CreateStaffDto staffDto)
        {
            var staff = new Staff
            {
                FullName = staffDto.FullName,
                CNIC = staffDto.CNIC,
                Qualification = staffDto.Qualification,
                Salary = staffDto.Salary,
                Role = staffDto.RoleName,
                CampusId = staffDto.CampusId,
                Email = staffDto.Email,
                JoiningDate = DateTime.Now,
                IsActive = true
            };

            _context.Staff.Add(staff);
            await _context.SaveChangesAsync();

            // Also create a user account for login
            await _authService.RegisterAsync(new RegisterRequestDto
            {
                FullName = staffDto.FullName,
                Username = staffDto.Email.Split('@')[0],
                Email = staffDto.Email,
                Password = staffDto.Password,
                RoleName = staffDto.RoleName,
                CampusId = staffDto.CampusId
            });

            return await GetStaffByIdAsync(staff.Id);
        }

        public async Task<bool> UpdateStaffAsync(int id, UpdateStaffDto staffDto)
        {
            var staff = await _context.Staff.FindAsync(id);
            if (staff == null) return false;

            staff.FullName = staffDto.FullName;
            staff.CNIC = staffDto.CNIC;
            staff.Qualification = staffDto.Qualification;
            staff.Salary = staffDto.Salary;
            staff.Role = staffDto.RoleName;
            staff.CampusId = staffDto.CampusId;
            staff.Email = staffDto.Email;

            _context.Staff.Update(staff);
            return await _context.SaveChangesAsync() > 0;
        }

        public async Task<bool> DeleteStaffAsync(int id)
        {
            var staff = await _context.Staff.FindAsync(id);
            if (staff == null) return false;

            _context.Staff.Remove(staff);
            return await _context.SaveChangesAsync() > 0;
        }
    }
}
