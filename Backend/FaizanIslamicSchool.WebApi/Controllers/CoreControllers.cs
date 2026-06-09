using Microsoft.AspNetCore.Mvc;
using FaizanIslamicSchool.Application.Interfaces;
using FaizanIslamicSchool.Application.DTOs;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace FaizanIslamicSchool.WebApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class StudentsController : ControllerBase
    {
        private readonly IStudentService _studentService;

        public StudentsController(IStudentService studentService)
        {
            _studentService = studentService;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<StudentDto>>> Get()
        {
            var students = await _studentService.GetAllStudentsAsync();
            return Ok(students);
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<StudentDto>> Get(int id)
        {
            var student = await _studentService.GetStudentByIdAsync(id);
            if (student == null) return NotFound();
            return Ok(student);
        }

        [HttpPost]
        public async Task<ActionResult<StudentDto>> Post([FromBody] CreateStudentDto studentDto)
        {
            var student = await _studentService.AddStudentAsync(studentDto);
            return CreatedAtAction(nameof(Get), new { id = student.Id }, student);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Put(int id, [FromBody] UpdateStudentDto studentDto)
        {
            var result = await _studentService.UpdateStudentAsync(id, studentDto);
            if (!result) return NotFound();
            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            var result = await _studentService.DeleteStudentAsync(id);
            if (!result) return NotFound();
            return NoContent();
        }

        [HttpGet("defaulters")]
        public async Task<ActionResult<IEnumerable<StudentDto>>> GetDefaulters()
        {
            var defaulters = await _studentService.GetDefaultersAsync();
            return Ok(defaulters);
        }
    }

    [ApiController]
    [Route("api/[controller]")]
    public class FeesController : ControllerBase
    {
        private readonly IFeeService _feeService;

        public FeesController(IFeeService feeService)
        {
            _feeService = feeService;
        }

        [HttpPost("generate-bulk")]
        public async Task<IActionResult> GenerateBulk([FromQuery] int month, [FromQuery] int year, [FromQuery] int? campusId)
        {
            var result = await _feeService.GenerateVouchersForMonthAsync(month, year, campusId);
            if (!result) return BadRequest("Failed to generate vouchers.");
            return Ok("Vouchers generated successfully.");
        }

        [HttpPost("generate-single/{studentId}")]
        public async Task<ActionResult<FeeVoucherDto>> GenerateSingle(int studentId, [FromQuery] int month, [FromQuery] int year)
        {
            var voucher = await _feeService.GenerateSingleVoucherAsync(studentId, month, year);
            return Ok(voucher);
        }

        [HttpPost("quickpay/callback")]
        public async Task<IActionResult> QuickPayCallback([FromBody] QuickPayCallbackDto callbackDto)
        {
            var result = await _feeService.ProcessQuickPayCallbackAsync(callbackDto);
            if (!result) return BadRequest("Failed to process callback.");
            return Ok();
        }
    }
}
