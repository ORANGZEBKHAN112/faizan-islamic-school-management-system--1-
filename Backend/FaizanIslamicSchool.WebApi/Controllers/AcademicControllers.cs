using Microsoft.AspNetCore.Mvc;
using FaizanIslamicSchool.Application.Interfaces;
using FaizanIslamicSchool.Application.DTOs;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace FaizanIslamicSchool.WebApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CampusesController : ControllerBase
    {
        private readonly ICampusService _campusService;

        public CampusesController(ICampusService campusService)
        {
            _campusService = campusService;
        }

        [HttpGet]
        public async Task<ActionResult<IEnumerable<CampusDto>>> Get()
        {
            var campuses = await _campusService.GetAllCampusesAsync();
            return Ok(campuses);
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<CampusDto>> Get(int id)
        {
            var campus = await _campusService.GetCampusByIdAsync(id);
            if (campus == null) return NotFound();
            return Ok(campus);
        }

        [HttpPost]
        public async Task<ActionResult<CampusDto>> Post([FromBody] CreateCampusDto campusDto)
        {
            var campus = await _campusService.AddCampusAsync(campusDto);
            return CreatedAtAction(nameof(Get), new { id = campus.Id }, campus);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Put(int id, [FromBody] UpdateCampusDto campusDto)
        {
            var result = await _campusService.UpdateCampusAsync(id, campusDto);
            if (!result) return NotFound();
            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            var result = await _campusService.DeleteCampusAsync(id);
            if (!result) return NotFound();
            return NoContent();
        }
    }

    [ApiController]
    [Route("api/[controller]")]
    public class ClassesController : ControllerBase
    {
        private readonly IClassService _classService;

        public ClassesController(IClassService classService)
        {
            _classService = classService;
        }

        [HttpGet("campus/{campusId}")]
        public async Task<ActionResult<IEnumerable<ClassDto>>> GetByCampus(int campusId)
        {
            var classes = await _classService.GetClassesByCampusIdAsync(campusId);
            return Ok(classes);
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<ClassDto>> Get(int id)
        {
            var cls = await _classService.GetClassByIdAsync(id);
            if (cls == null) return NotFound();
            return Ok(cls);
        }

        [HttpPost]
        public async Task<ActionResult<ClassDto>> Post([FromBody] CreateClassDto classDto)
        {
            var cls = await _classService.AddClassAsync(classDto);
            return CreatedAtAction(nameof(Get), new { id = cls.Id }, cls);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> Put(int id, [FromBody] UpdateClassDto classDto)
        {
            var result = await _classService.UpdateClassAsync(id, classDto);
            if (!result) return NotFound();
            return NoContent();
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(int id)
        {
            var result = await _classService.DeleteClassAsync(id);
            if (!result) return NotFound();
            return NoContent();
        }
    }

    [ApiController]
    [Route("api/[controller]")]
    public class ExamsController : ControllerBase
    {
        private readonly IExamService _examService;

        public ExamsController(IExamService examService)
        {
            _examService = examService;
        }

        [HttpGet("terms/{campusId}")]
        public async Task<ActionResult<IEnumerable<ExamTermDto>>> GetTerms(int campusId)
        {
            var terms = await _examService.GetExamTermsAsync(campusId);
            return Ok(terms);
        }

        [HttpPost("marks")]
        public async Task<IActionResult> PostMarks([FromBody] IEnumerable<StudentMarksDto> marks)
        {
            var result = await _examService.AddMarksAsync(marks);
            if (!result) return BadRequest("Failed to add marks.");
            return Ok();
        }

        [HttpGet("result-card/{studentId}/{termId}")]
        public async Task<ActionResult<ResultCardDto>> GetResultCard(int studentId, int termId)
        {
            var resultCard = await _examService.GetResultCardAsync(studentId, termId);
            if (resultCard == null) return NotFound();
            return Ok(resultCard);
        }
    }
}
